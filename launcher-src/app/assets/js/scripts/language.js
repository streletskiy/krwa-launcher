const launcherLanguageButton = document.getElementById('launcherLanguageButton')
const launcherLanguageFlag = document.getElementById('launcherLanguageFlag')
const launcherLanguageMenu = document.getElementById('launcherLanguageMenu')
const launcherLanguageOptions = Array.from(document.querySelectorAll('.launcherLanguageOption'))
const launcherLanguagePreference = Lang.getPreference()

function setLauncherLanguageMenuOpen(open) {
    launcherLanguageMenu.hidden = !open
    launcherLanguageButton.setAttribute('aria-expanded', String(open))
    if(open) launcherLanguageOptions.find(option => option.dataset.language === launcherLanguagePreference)?.focus()
}

function launcherLanguageChangeBlocked() {
    return document.getElementById('landingContainer').dataset.launching === 'true' || nativeBusy
}

launcherLanguageFlag.dataset.language = Lang.getLanguage()
launcherLanguageOptions.forEach(option => {
    const selected = option.dataset.language === launcherLanguagePreference
    option.setAttribute('aria-checked', String(selected))
    if(selected) launcherLanguageButton.title = option.textContent.trim()

    option.onclick = async event => {
        event.stopPropagation()
        setLauncherLanguageMenuOpen(false)
        if(launcherLanguageChangeBlocked() || selected) return
        if(typeof fullSettingsSave === 'function' && getCurrentView() === VIEWS.settings) fullSettingsSave()
        await ipcRenderer.invoke('setLauncherLanguage', option.dataset.language)
        window.location.reload()
    }
})

launcherLanguageButton.onclick = event => {
    event.stopPropagation()
    if(launcherLanguageChangeBlocked()) return
    setLauncherLanguageMenuOpen(launcherLanguageMenu.hidden)
}

launcherLanguageMenu.onkeydown = event => {
    const current = launcherLanguageOptions.indexOf(document.activeElement)
    let next = current
    if(event.key === 'ArrowDown') next = (current + 1) % launcherLanguageOptions.length
    else if(event.key === 'ArrowUp') next = (current - 1 + launcherLanguageOptions.length) % launcherLanguageOptions.length
    else if(event.key === 'Home') next = 0
    else if(event.key === 'End') next = launcherLanguageOptions.length - 1
    else if(event.key === 'Escape') {
        setLauncherLanguageMenuOpen(false)
        launcherLanguageButton.focus()
        return
    } else return
    event.preventDefault()
    launcherLanguageOptions[next].focus()
}

document.addEventListener('click', () => setLauncherLanguageMenuOpen(false))
