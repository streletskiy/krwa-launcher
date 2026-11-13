const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROFILE_ID = 'krwa-aeronautics-1.21.1'
const DECK_MODS = ['curseforge.project-835847:file', 'curseforge.project-335493:file']

function detectSteamDeck(platform = process.platform, env = process.env, read = fs.readFileSync) {
    if (platform !== 'linux') return { detected: false, gamingMode: false }
    const readDmi = name => {
        try {
            return read(`/sys/class/dmi/id/${name}`, 'utf8').trim()
        } catch {
            return ''
        }
    }
    const valve = /\bvalve\b/i.test(readDmi('board_vendor') || readDmi('sys_vendor'))
    const detected = env.SteamDeck === '1' || (valve && /^(Jupiter|Galileo)$/i.test(readDmi('board_name') || readDmi('product_name')))
    return { detected, gamingMode: detected && env.SteamDeck === '1' }
}

function getSteamDeckMods(server) {
    if (server?.rawServer.id !== PROFILE_ID) return []
    const available = server.modules
        .filter(mod => mod.rawModule.type === 'ForgeMod' && !mod.getRequired().value)
        .map(mod => mod.getVersionlessMavenIdentifier())
    return DECK_MODS.every(id => available.includes(id)) ? DECK_MODS.slice() : []
}

function getDisabledSteamDeckMods(server, mods) {
    if (!mods) return []
    return getSteamDeckMods(server).filter(id => {
        const value = mods[id]
        return value !== true && value?.value !== true
    })
}

function getSteamDeckLanguages({ env = process.env, homeDirectory = os.homedir(), read = fs.readFileSync, list = fs.readdirSync } = {}) {
    const gamingMode = env.SteamDeck === '1' || env.XDG_CURRENT_DESKTOP === 'gamescope'
    const readText = file => {
        try { return read(file, 'utf8') } catch { return '' }
    }
    let steamLanguage
    if (gamingMode) {
        try {
            for (const pid of list('/proc')) {
                if (!/^\d+$/.test(pid)) continue
                if (readText(`/proc/${pid}/comm`).trim() !== 'steamwebhelper') continue
                const [executable, ...args] = readText(`/proc/${pid}/cmdline`).split('\0')
                if (path.basename(executable) !== 'steamwebhelper') continue
                steamLanguage = args.find(arg => arg.startsWith('-lang='))?.slice(6)
                if (steamLanguage) break
            }
        } catch { /* Fall back to the desktop locale. */ }
    }
    const config = env.XDG_CONFIG_HOME || path.join(homeDirectory, '.config')
    const locale = readText(path.join(config, 'plasma-localerc'))
    const formats = /^\[Formats\][^\S\n]*\n([^[]*)/m.exec(locale)?.[1] || ''
    const translations = /^\[Translations\][^\S\n]*\n([^[]*)/m.exec(locale)?.[1] || ''
    const desktopLanguages = /^LANGUAGE=(.*)$/m.exec(translations)?.[1]?.trim().split(':') || []
    const desktopLocale = /^LANG=(.*)$/m.exec(formats)?.[1]?.trim()
    return [steamLanguage, ...desktopLanguages, desktopLocale].filter(Boolean)
}

module.exports = { detectSteamDeck, getSteamDeckMods, getDisabledSteamDeckMods, getSteamDeckLanguages }
