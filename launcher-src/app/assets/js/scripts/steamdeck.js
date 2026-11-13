const { getSteamDeckMods } = require('./assets/js/steamdeck')
const steamDeckPreset = document.getElementById('steamDeckPreset')
const steamDeckEnableMods = document.getElementById('steamDeckEnableMods')

function updateSteamDeckPreset(server) {
    const ids = getSteamDeckMods(server)
    steamDeckPreset.hidden = ids.length === 0
    steamDeckEnableMods.onclick = () => {
        for (const input of document.querySelectorAll('#settingsModsContainer input[formod]')) {
            if (ids.includes(input.getAttribute('formod')) && !input.checked) input.click()
        }
        saveModConfiguration()
        ConfigManager.markSteamDeckPromptAnswered()
        ConfigManager.save()
    }
}

function offerSteamDeckMods(server) {
    if (!document.body.dataset.steamDeck || ConfigManager.hasAnsweredSteamDeckPrompt()) return
    const ids = getSteamDeckMods(server)
    if (ids.length === 0) return
    const config = ConfigManager.getModConfiguration(server.rawServer.id)
    if (!config || ids.every(id => config.mods[id] === true)) return
    const finish = enable => {
        if (enable) {
            for (const id of ids) config.mods[id] = true
            ConfigManager.setModConfiguration(server.rawServer.id, config)
        }
        ConfigManager.markSteamDeckPromptAnswered()
        ConfigManager.save()
        toggleOverlay(false)
    }
    setOverlayContent(
        'Steam Deck',
        Lang.native('Включить Controlify для управления и Dynamic FPS для экономии заряда? Выбор можно изменить в настройках модов.'),
        Lang.native('Включить моды для Steam Deck'),
        Lang.native('Пропустить')
    )
    setOverlayHandler(() => finish(true))
    setDismissHandler(() => finish(false))
    toggleOverlay(true, true)
}
