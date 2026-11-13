{
    const { findInDirection, readGamepad } = require('./assets/js/gamepad')
    const focusable = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]'
    const textField = 'input:not([readonly]):is([type="text"], [type="password"], [type="email"], [type="search"], [type="number"], [type="url"], [type="tel"], :not([type])), textarea:not([readonly])'
    const hints = document.getElementById('gamepadHints')
    const deck = Boolean(document.body.dataset.steamDeck)
    let activePad = null
    let previous = null
    let repeatAt = 0
    let lastFrame = 0
    let usedGamepad = false

    function isVisible(element) {
        return Boolean(element?.checkVisibility({ visibilityProperty: true }) &&
            !element.matches(':disabled') && !element.closest('[hidden], [inert], [aria-hidden="true"]'))
    }

    function controls() {
        const menu = document.getElementById('launcherLanguageMenu')
        const loading = document.getElementById('loadingContainer')
        if (isOverlayVisible()) {
            return Array.from(document.querySelectorAll(`#overlayContainer :is(${focusable})`)).filter(isVisible)
        }
        if (loading.checkVisibility()) return []
        if (!menu.hidden) return Array.from(menu.querySelectorAll('button')).filter(isVisible)
        const view = getCurrentView()
        if (!view) return []
        const selector = `${view} :is(${focusable}), #launcherLanguageButton`
        return Array.from(document.querySelectorAll(selector)).filter(el => el.tabIndex >= 0 && isVisible(el))
    }

    function focusControl(element) {
        if (!element) return
        element.focus({ preventScroll: true })
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }

    function startFocus(elements) {
        return elements.find(el => el.matches('[selected], #launch_button, #loginUsername, #welcomeButton')) ||
            elements.find(el => el.id !== 'launcherLanguageButton') || elements[0]
    }

    function move(elements, direction) {
        const current = document.activeElement
        if (!elements.includes(current)) {
            focusControl(startFocus(elements))
            return
        }
        const next = findInDirection(current, elements, direction)
        focusControl(next)
    }

    function back(elements) {
        if (!document.getElementById('launcherLanguageMenu').hidden && !isOverlayVisible()) {
            document.getElementById('launcherLanguageButton').click()
            document.getElementById('launcherLanguageButton').focus()
            return
        }
        const selector = isOverlayVisible() ? '.overlayKeybindEsc' :
            '#settingsNavDone, #nativeAccountBack, #loginCancelButton, #loginOptionCancelButton'
        elements.find(el => el.matches(selector))?.click()
    }

    function activate(elements, keyboardOnly = false) {
        const element = elements.includes(document.activeElement) ? document.activeElement : null
        if (!element) {
            if (!keyboardOnly) focusControl(startFocus(elements))
            return
        }
        if (element.matches(textField)) {
            if (deck) ipcRenderer.invoke('openSteamDeckKeyboard').catch(() => {})
            return
        }
        if (!keyboardOnly) element.click()
    }

    function setGamepadMode(enabled) {
        usedGamepad = enabled
        document.body.classList.toggle('gamepad-navigation', enabled)
        hints.hidden = !enabled
    }

    function pollGamepad(now) {
        requestAnimationFrame(pollGamepad)
        const elapsed = Math.min(now - lastFrame, 32)
        lastFrame = now
        if (!document.hasFocus() || document.hidden) {
            previous = null
            return
        }
        const pads = Array.from(navigator.getGamepads?.() || []).filter(pad => pad?.mapping === 'standard')
        const pad = pads.find(pad => pad.index === activePad && readGamepad(pad).engaged) ||
            pads.find(pad => readGamepad(pad).engaged) || pads.find(pad => pad.index === activePad)
        if (!pad) {
            previous = null
            activePad = null
            if (usedGamepad) setGamepadMode(false)
            return
        }
        const state = readGamepad(pad)
        if (activePad !== pad.index) {
            previous = null
            activePad = pad.index
        }
        if (state.engaged && !usedGamepad && (!previous?.engaged || state.direction !== previous.direction)) setGamepadMode(true)
        if (previous) {
            const elements = controls()
            if (state.back && !previous.back) back(elements)
            else if (state.keyboard && !previous.keyboard) activate(elements, true)
            else if (state.select && !previous.select) activate(elements)
            else if (state.tab && state.tab !== previous.tab) {
                if (getCurrentView() === VIEWS.settings && !isOverlayVisible()) {
                    const tabs = elements.filter(el => el.matches('.settingsNavItem'))
                    const selected = tabs.findIndex(el => el.hasAttribute('selected'))
                    const tab = tabs[selected + state.tab]
                    tab?.click()
                    focusControl(tab)
                }
            } else if (state.direction && (state.direction !== previous.direction || now >= repeatAt)) {
                move(elements, state.direction)
                repeatAt = now + (state.direction === previous.direction ? 110 : 320)
            }
            if (state.scroll) document.activeElement?.closest('.settingsTab, #serverSelectListScrollable, #accountSelectListScrollable')?.scrollBy(0, state.scroll * elapsed * 0.7)
        } else if (state.engaged) {
            const elements = controls()
            if (!elements.includes(document.activeElement)) focusControl(startFocus(elements))
            repeatAt = now + 320
        }
        previous = state
    }

    document.addEventListener('pointerdown', () => {
        if (usedGamepad) setGamepadMode(false)
    }, true)
    requestAnimationFrame(pollGamepad)
}
