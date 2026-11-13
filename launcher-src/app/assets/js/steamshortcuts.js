const fs = require('node:fs')
const path = require('node:path')

const APP_NAME = 'KRWA Launcher'
const ARTWORK = [
    ['p', 'portrait.jpg'],
    ['', 'landscape.jpg'],
    ['_hero', 'hero.jpg'],
    ['_logo', 'logo.png']
]

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
            if (['.jpg', '.jpeg', '.png', '.webp'].some(extension => fs.existsSync(basename + extension))) continue
            try {
                fs.copyFileSync(path.join(artworkDirectory, source), basename + path.extname(source), fs.constants.COPYFILE_EXCL)
            } catch (error) {
                if (error.code !== 'EEXIST') throw error
            }
        }
    }
}

module.exports = { findKrwaSteamShortcuts, installSteamArtwork }
