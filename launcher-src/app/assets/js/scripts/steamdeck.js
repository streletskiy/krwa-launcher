const { getSteamDeckMods, getDisabledSteamDeckMods } = require('./assets/js/steamdeck')
const steamDeckPreset = document.getElementById('steamDeckPreset')
const steamDeckEnableMods = document.getElementById('steamDeckEnableMods')
const steamDeckOffer = document.getElementById('steamDeckOffer')
const steamDeckOfferEnable = document.getElementById('steamDeckOfferEnable')

function updateSteamDeckPreset(ids) {
    steamDeckPreset.hidden = ids.length === 0
    const inputs = Array.from(document.querySelectorAll('#settingsDeckModsContent input[formod]'))
    const updateButton = () => {
        steamDeckEnableMods.disabled = inputs.every(input => input.checked)
    }
    for (const input of inputs) input.addEventListener('change', updateButton)
    updateButton()
    steamDeckEnableMods.onclick = () => {
        for (const input of inputs) {
            if (!input.checked) input.click()
        }
        saveModConfiguration()
        ConfigManager.save()
        inputs[0]?.focus({ preventScroll: true })
    }
}

async function refreshSteamDeckOffer() {
    if (!document.body.dataset.steamDeck || getCurrentView() !== VIEWS.landing) return
    const distribution = await DistroAPI.getDistribution().catch(() => null)
    if (getCurrentView() !== VIEWS.landing) return
    const id = ConfigManager.getSelectedServer()
    const config = ConfigManager.getModConfiguration(id)
    const ids = getDisabledSteamDeckMods(distribution?.getServerById(id), config?.mods)
    steamDeckOffer.hidden = ids.length === 0
    steamDeckOfferEnable.onclick = () => {
        if (ConfigManager.getSelectedServer() !== id || document.getElementById('landingContainer').dataset.launching === 'true') return
        for (const modId of ids) {
            const value = config.mods[modId]
            config.mods[modId] = value && typeof value === 'object' ? { ...value, value: true } : true
        }
        ConfigManager.save()
        steamDeckOffer.hidden = true
        document.getElementById('launch_button').focus({ preventScroll: true })
    }
}
