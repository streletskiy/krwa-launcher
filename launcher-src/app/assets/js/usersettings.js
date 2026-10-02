const crypto = require('crypto')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const { atomicWriteFileSync, readFileIfExistsSync, resolveArchiveEntry } = require('./filesystemutil')

const PACK_CONFIG_DIRECTORIES = [
    'config/fancymenu/',
    'config/drippyloadingscreen/',
    'config/paxi/',
    'config/ftbquests/quests/'
]
const SETTINGS_EXTENSION = /\.(?:toml|json5?|cfg|conf|ini|properties|txt|ya?ml|xml)$/i
const ROOT_SETTINGS_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat']

function isUserSettingsPath(relativePath) {
    const normalized = relativePath.replaceAll('\\', '/').toLowerCase()
    if(ROOT_SETTINGS_FILES.includes(normalized)) return true
    return normalized.startsWith('config/')
        && !normalized.split('/').includes('..')
        && SETTINGS_EXTENSION.test(normalized)
        && normalized !== 'config/bcc-common.toml'
        && !PACK_CONFIG_DIRECTORIES.some(directory => normalized.startsWith(directory))
}

function digest(data) {
    return crypto.createHash('md5').update(data).digest('hex')
}

// Never read or replace settings through a symlink, including a linked parent.
function readSetting(gameDir, relativePath) {
    const parts = relativePath.replaceAll('\\', '/').split('/')
    let current = gameDir
    for(let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index])
        let stat
        try {
            stat = fs.lstatSync(current)
        } catch(error) {
            if(error.code === 'ENOENT') return { data: null, hash: null }
            throw error
        }
        if(stat.isSymbolicLink() || (index === parts.length - 1 && !stat.isFile())) return { linked: true }
    }
    const data = fs.readFileSync(current)
    return { data, hash: digest(data) }
}

class UserSettingsPreserver {
    constructor(gameDir, server, logger = console) {
        this.gameDir = path.resolve(gameDir)
        this.version = server.rawServer.version
        this.logger = logger
        this.stateFile = path.join(this.gameDir, '.krwa-user-settings.json')
        this.entries = new Map()
        this.pending = new Map()
        this.temporaryDirectory = null
        this.preservedCount = 0
        this.previous = { files: {} }
        const state = readFileIfExistsSync(this.stateFile, 'utf8')
        if(state != null) {
            try {
                const parsed = JSON.parse(state)
                if(parsed.format !== 1 || parsed.files == null || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
                    throw new Error('Invalid settings state format.')
                }
                this.previous = parsed
            } catch(error) {
                logger.warn('Could not read settings history; preserving existing settings conservatively.', error)
            }
        }

        const visit = modules => {
            for(const module of modules) {
                const relativePath = module.rawModule.artifact.path
                if(module.rawModule.type === 'File' && typeof relativePath === 'string' && isUserSettingsPath(relativePath)) {
                    const destination = resolveArchiveEntry(this.gameDir, relativePath)
                    if(path.resolve(module.getPath()) !== destination) throw new Error('Settings artifact has an inconsistent destination.')
                    const key = path.resolve(destination)
                    const hash = module.rawModule.artifact.MD5?.toLowerCase() ?? null
                    const previousEntry = this.entries.get(key)
                    if(previousEntry != null && previousEntry.hash !== hash) throw new Error('Conflicting defaults for the same settings file.')
                    this.entries.set(key, { path: destination, relativePath: relativePath.replaceAll('\\', '/'), hash })
                }
                visit(module.subModules ?? [])
            }
        }
        visit(server.modules)
        this.createBackup()
    }

    createBackup() {
        if(this.previous.version === this.version) return
        const backupPaths = new Set([...ROOT_SETTINGS_FILES, ...[...this.entries.values()].map(entry => entry.relativePath)])
        for(const relativePath of backupPaths) {
            const current = readSetting(this.gameDir, relativePath)
            if(current.data == null) continue
            if(this.backupDirectory == null) {
                const backupRoot = path.join(this.gameDir, '.krwa-settings-backups')
                fs.ensureDirSync(backupRoot, { mode: 0o700 })
                if(fs.lstatSync(backupRoot).isSymbolicLink()) throw new Error('Settings backup directory must not be a symlink.')
                const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
                this.backupDirectory = fs.mkdtempSync(path.join(backupRoot, `${stamp}-`))
            }
            atomicWriteFileSync(resolveArchiveEntry(this.backupDirectory, relativePath), current.data)
        }
        if(this.backupDirectory != null) {
            atomicWriteFileSync(path.join(this.backupDirectory, 'backup.json'), JSON.stringify({
                format: 1, modpackVersion: this.version, createdAt: new Date().toISOString()
            }, null, 2), 'utf8')
            this.logger.info('Created a local settings backup:', this.backupDirectory)
        }
    }

    filterAssets(assets) {
        const filtered = []
        for(const asset of assets) {
            const entry = this.entries.get(path.resolve(asset.path))
            if(entry == null) {
                filtered.push(asset)
                continue
            }
            const current = readSetting(this.gameDir, entry.relativePath)
            const previousDefault = this.previous.files[entry.relativePath]
            if(current.linked || (current.data != null && current.hash !== previousDefault)) {
                this.preservedCount++
                continue
            }
            if(this.pending.has(entry.path)) continue
            if(this.temporaryDirectory == null) {
                this.temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-settings-'))
                fs.chmodSync(this.temporaryDirectory, 0o700)
            }
            const stagedAsset = {
                ...asset,
                id: `settings:${entry.relativePath}`,
                path: resolveArchiveEntry(this.temporaryDirectory, entry.relativePath)
            }
            this.pending.set(entry.path, { entry, originalHash: current.hash, asset: stagedAsset })
            filtered.push(stagedAsset)
        }
        if(this.preservedCount > 0) this.logger.info(`Preserved ${this.preservedCount} customized settings files.`)
        return filtered
    }

    commit() {
        // Downloads are staged: a failed transfer never damages the current settings.
        const downloaded = [...this.pending.values()].map(pending => {
            const data = fs.readFileSync(pending.asset.path)
            if((pending.entry.hash != null && digest(data) !== pending.entry.hash)
                || (Number.isFinite(pending.asset.size) && data.length !== pending.asset.size)) {
                const error = new Error('Settings download failed integrity validation.')
                error.code = 'EINTEGRITY'
                throw error
            }
            return { ...pending, data }
        })
        for(const pending of downloaded) {
            const current = readSetting(this.gameDir, pending.entry.relativePath)
            // An edit made while the download was running also belongs to the player.
            if(current.linked || current.hash !== pending.originalHash) continue
            atomicWriteFileSync(pending.entry.path, pending.data)
        }
        const files = Object.fromEntries([...this.entries.values()].map(entry => [entry.relativePath, entry.hash]))
        atomicWriteFileSync(this.stateFile, JSON.stringify({ format: 1, version: this.version, files }, null, 2), 'utf8')
        this.dispose()
    }

    dispose() {
        if(this.temporaryDirectory != null) {
            const temporaryPath = path.resolve(this.temporaryDirectory)
            if(path.dirname(temporaryPath) !== path.resolve(os.tmpdir()) || !path.basename(temporaryPath).startsWith('krwa-settings-')) {
                throw new Error('Settings staging directory is outside the temporary directory.')
            }
            fs.removeSync(temporaryPath)
            this.temporaryDirectory = null
        }
    }
}

module.exports = { UserSettingsPreserver, isUserSettingsPath }
