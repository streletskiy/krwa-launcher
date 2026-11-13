const fs = require('node:fs')

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

module.exports = { detectSteamDeck, getSteamDeckMods, getDisabledSteamDeckMods }
