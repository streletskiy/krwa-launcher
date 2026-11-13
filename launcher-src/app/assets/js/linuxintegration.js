const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setTimeout: delay } = require('node:timers/promises')
const semver = require('semver')
const { findKrwaSteamShortcuts, installSteamArtwork } = require('./steamshortcuts')

const DESKTOP_ID = 'ru.krwa.launcher'

function desktopExecArgument(value) {
    if(typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
        throw new Error('Invalid desktop entry path')
    }
    return `"${value
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('`', '\\`')
        .replaceAll('$', '\\$')
        .replaceAll('%', '%%')}"`
}

function desktopEntry(executablePath, iconPath, appImage = false) {
    return [
        '[Desktop Entry]',
        'Name=KRWA Launcher',
        'Name[ru]=KRWA Launcher',
        'Name[pl]=KRWA Launcher',
        'Comment=KRWA Minecraft Launcher',
        'Comment[ru]=Лаунчер Minecraft-сервера KRWA',
        'Comment[pl]=Launcher serwera Minecraft KRWA',
        `Exec=${appImage ? 'env APPIMAGE_EXTRACT_AND_RUN=1 ' : ''}${desktopExecArgument(executablePath)}`,
        `Icon=${iconPath}`,
        'Terminal=false',
        'Type=Application',
        'Categories=Game;',
        'StartupWMClass=ru.krwa.launcher',
        ''
    ].join('\n')
}

function atomicCopy(source, destination, mode) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    try {
        fs.copyFileSync(source, temporary)
        if(mode !== undefined) fs.chmodSync(temporary, mode)
        fs.renameSync(temporary, destination)
    } finally {
        try { fs.rmSync(temporary, { force: true }) } catch { /* Best-effort cleanup. */ }
    }
}

function atomicWrite(destination, content, mode) {
    if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === content) {
        if (mode === 0o755) fs.chmodSync(destination, mode)
        return
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode })
        fs.renameSync(temporary, destination)
    } finally {
        try { fs.rmSync(temporary, { force: true }) } catch { /* Best-effort cleanup. */ }
    }
}

function isExecutable(file) {
    try {
        fs.accessSync(file, fs.constants.X_OK)
        return true
    } catch {
        return false
    }
}

function findExecutable(name, environmentPath = process.env.PATH || '') {
    const candidates = environmentPath.split(path.delimiter)
        .filter(Boolean)
        .map(directory => path.join(directory, name))
    candidates.push(path.join('/usr/bin', name))
    return candidates.find(isExecutable)
}

function run(executable, args, timeout = 15000) {
    return new Promise(resolve => {
        let settled = false
        const child = childProcess.spawn(executable, args, {
            stdio: 'ignore',
            detached: false
        })
        const finish = code => {
            if(settled) return
            settled = true
            clearTimeout(timer)
            resolve(code === 0)
        }
        const timer = setTimeout(() => {
            child.kill()
            finish(null)
        }, timeout)
        child.once('error', () => finish(null))
        child.once('close', finish)
    })
}

async function addDesktopEntryToSteam(desktopFile, options = {}) {
    const helper = options.steamHelper || findExecutable('steamos-add-to-steam', options.environmentPath)
    if(!helper) return false
    const runner = options.runCommand || run
    return runner(helper, [desktopFile])
}

function desktopDirectory(homeDirectory, configHome) {
    const configFile = path.join(configHome, 'user-dirs.dirs')
    if (fs.existsSync(configFile)) {
        const configured = /^XDG_DESKTOP_DIR="([^"]+)"$/m.exec(fs.readFileSync(configFile, 'utf8'))?.[1]
        if (configured === '$HOME') return null
        if (configured?.startsWith('$HOME/')) return path.join(homeDirectory, configured.slice(6))
        if (configured && path.isAbsolute(configured)) return configured === homeDirectory ? null : configured
    }
    return path.join(homeDirectory, 'Desktop')
}

async function installLinuxIntegration(options = {}) {
    const homeDirectory = path.resolve(options.homeDirectory || os.homedir())
    const appImageSource = options.appImageSource || process.env.APPIMAGE
    const packagedExecutable = options.packagedExecutable || process.execPath
    const iconSource = options.iconSource

    if(!iconSource || !fs.statSync(iconSource).isFile()) throw new Error('Launcher icon is unavailable')

    const installDirectory = path.join(homeDirectory, '.local', 'opt', 'krwa-launcher')
    const installedAppImage = path.join(installDirectory, 'KRWA-Launcher.AppImage')
    const versionFile = path.join(installDirectory, 'version')
    let executablePath = packagedExecutable
    let installedAppImageCopy = false

    if(appImageSource) {
        if(!fs.statSync(appImageSource).isFile()) throw new Error('AppImage is unavailable')
        executablePath = installedAppImage
        if(path.resolve(appImageSource) !== path.resolve(installedAppImage)) {
            const installedVersion = fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8').trim()
            const currentEnough = options.automatic && fs.existsSync(installedAppImage) &&
                semver.valid(installedVersion) && semver.valid(options.version) && semver.gte(installedVersion, options.version)
            if (!currentEnough) {
                atomicCopy(appImageSource, installedAppImage, 0o755)
                installedAppImageCopy = true
            }
        } else {
            fs.chmodSync(installedAppImage, 0o755)
        }
        if (semver.valid(options.version) && (installedAppImageCopy || path.resolve(appImageSource) === installedAppImage)) {
            atomicWrite(versionFile, options.version, 0o644)
        }
    } else if(!packagedExecutable || !fs.statSync(packagedExecutable).isFile()) {
        throw new Error('Packaged launcher executable is unavailable')
    }

    const dataHome = options.dataHome || path.join(homeDirectory, '.local', 'share')
    const iconPath = path.join(dataHome, 'icons', 'hicolor', '512x512', 'apps', `${DESKTOP_ID}.png`)
    const desktopFile = path.join(dataHome, 'applications', `${DESKTOP_ID}.desktop`)
    if (!fs.existsSync(iconPath) || !fs.readFileSync(iconPath).equals(fs.readFileSync(iconSource))) atomicCopy(iconSource, iconPath, 0o644)
    const entry = desktopEntry(executablePath, iconPath, Boolean(appImageSource))
    atomicWrite(desktopFile, entry, 0o644)
    if (options.steamDeck) {
        const desktop = desktopDirectory(homeDirectory, options.configHome || path.join(homeDirectory, '.config'))
        if (desktop) atomicWrite(path.join(desktop, 'KRWA Launcher.desktop'), entry, 0o755)
    }

    const desktopDatabase = findExecutable('update-desktop-database', options.environmentPath)
    if(desktopDatabase && !options.automatic) {
        const runner = options.runCommand || run
        await runner(desktopDatabase, [path.dirname(desktopFile)])
    }

    let shortcuts = findKrwaSteamShortcuts(homeDirectory, executablePath)
    let steamAdded = shortcuts.length > 0
    if (!steamAdded && options.allowSteamAdd !== false) {
        const addToSteam = options.addToSteam || (file => addDesktopEntryToSteam(file, options))
        steamAdded = await addToSteam(desktopFile)
        if (steamAdded && options.artworkDirectory) {
            for (let attempt = 0; attempt < 12; attempt++) {
                shortcuts = findKrwaSteamShortcuts(homeDirectory, executablePath)
                if (shortcuts.length) break
                await delay(500)
            }
            steamAdded = shortcuts.length > 0
        }
    }
    if (options.artworkDirectory) installSteamArtwork(shortcuts, options.artworkDirectory)

    return {
        desktopFile,
        executablePath,
        installedAppImageCopy,
        steamAdded
    }
}

module.exports = {
    DESKTOP_ID,
    addDesktopEntryToSteam,
    desktopEntry,
    desktopExecArgument,
    installLinuxIntegration
}
