const languageSelect = document.getElementById('launcherLanguage')
languageSelect.value = Lang.getPreference()
languageSelect.onchange = async () => {
    if(document.getElementById('landingContainer').dataset.launching === 'true' || nativeBusy) {
        languageSelect.value = Lang.getPreference()
        return
    }
    if(typeof fullSettingsSave === 'function' && getCurrentView() === VIEWS.settings) fullSettingsSave()
    await ipcRenderer.invoke('setLauncherLanguage', languageSelect.value)
    window.location.reload()
}
