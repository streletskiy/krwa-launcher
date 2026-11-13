const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { atomicWriteFileSync, readFileIfExistsSync } = require('./filesystemutil')

const APP_NAME = 'KRWA Launcher'
const ARTWORK = [
    ['p', 'portrait.jpg'],
    ['', 'landscape.jpg'],
    ['_hero', 'hero.jpg'],
    ['_logo', 'logo.png']
]
// Hashes of the forest artwork shipped before the cargo port theme.
const PREVIOUS_ARTWORK = {
    'hero.jpg': 'b6dcd2fb663f6d42b123a0d1b57c50133654cc5432c2a2edf05b00a3695779dd',
    'landscape.jpg': 'a20290c9030089d6fb156ffb2df8d4f17a12ed49feab4902b330c0ac2c43866a',
    'logo.png': 'abbf7cdcb308c52d431bf8788194aa4458c9c576ed33d4b86e01d096bee7c0d5',
    'portrait.jpg': 'f426a529cf86bfe21bc454e6cd65fe8cf0d279fe59892e2cd65e56873a7c2664'
}

function readSteamShortcuts(file) {
    const bytes = fs.readFileSync(file)
    let offset = 0
    function readString() {
        const end = bytes.indexOf(0, offset)
        if (end === -1) throw new Error('Unterminated Steam shortcut field')
        const value = bytes.toString('utf8', offset, end)
        offset = end + 1
        return value
    }
    function readObject(depth = 0) {
        if (depth > 8) throw new Error('Too many nested Steam shortcut fields')
        const result = Object.create(null)
        while (offset < bytes.length) {
            const type = bytes.readUInt8(offset++)
            if (type === 8) return result
            const key = readString().toLowerCase()
            if (type === 0) result[key] = readObject(depth + 1)
            else if (type === 1) result[key] = readString()
            else if (type === 2) {
                result[key] = bytes.readUInt32LE(offset)
                offset += 4
            } else throw new Error('Unsupported Steam shortcut field')
        }
        throw new Error('Incomplete Steam shortcuts file')
    }
    return Object.values(readObject().shortcuts || {})
}

function findKrwaSteamShortcuts(homeDirectory, executablePath) {
    for (const directory of ['.steam/root', '.local/share/Steam', '.steam/steam']) {
        const userdata = path.join(homeDirectory, directory, 'userdata')
        if (!fs.existsSync(userdata)) continue
        return fs.readdirSync(userdata, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).flatMap(entry => {
            const config = path.join(userdata, entry.name, 'config')
            try {
                return readSteamShortcuts(path.join(config, 'shortcuts.vdf')).filter(shortcut => {
                    const executable = shortcut.exe?.replace(/^"|"$/g, '')
                    const filename = path.basename(executable || '').toLowerCase()
                    return Number.isInteger(shortcut.appid) && (executable === executablePath ||
                        (shortcut.appname === APP_NAME && (filename === 'krwa-launcher' ||
                            filename.startsWith('krwa-launcher-') || filename === 'krwa-launcher.appimage')))
                }).map(shortcut => ({ appId: shortcut.appid, grid: path.join(config, 'grid') }))
            } catch (error) {
                if (error.code === 'ENOENT') return []
                throw error
            }
        })
    }
    return []
}

function installSteamArtwork(shortcuts, artworkDirectory) {
    for (const { appId, grid } of shortcuts) {
        fs.mkdirSync(grid, { recursive: true })
        for (const [suffix, source] of ARTWORK) {
            // Steam accepts either format for each slot. Keep artwork set by the player.
            const basename = path.join(grid, `${appId}${suffix}`)
            const destination = basename + path.extname(source)
            const bundled = path.join(artworkDirectory, source)
            const existing = ['.jpg', '.jpeg', '.png', '.webp'].map(extension => basename + extension).filter(file => fs.existsSync(file))
            if (existing.length) {
                if (existing.length === 1 && existing[0] === destination) {
                    const artwork = readFileIfExistsSync(destination)
                    if (artwork && createHash('sha256').update(artwork).digest('hex') === PREVIOUS_ARTWORK[source]) {
                        atomicWriteFileSync(destination, fs.readFileSync(bundled))
                    }
                }
                continue
            }
            try {
                fs.copyFileSync(bundled, destination, fs.constants.COPYFILE_EXCL)
            } catch (error) {
                if (error.code !== 'EEXIST') throw error
            }
        }
    }
}

module.exports = { findKrwaSteamShortcuts, installSteamArtwork }
