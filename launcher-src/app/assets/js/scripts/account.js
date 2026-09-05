const NativeAccountAPI = require('./assets/js/accountapi').createAccountAPI()
const NativeSkinPreview = require('./assets/js/skinpreview')
const nativeForm = document.getElementById('nativeAccountForm')
const nativeStatus = document.getElementById('nativeAccountStatus')
const nativeSubmit = document.getElementById('nativeAccountSubmit')
let nativeMode = 'register', nativeBusy = false, nativeReturn = VIEWS.login, nativeCaptchaId = null, nativeResetConfirm = false, nativePreviewURL = null, nativeViewSerial = 0
let nativeCompletion = false
const nativeField = name => nativeForm.elements.namedItem(name)
const nativeLabels = { register: [Lang.native('Создай свой аккаунт'), Lang.native('Выбери ник, зарегистрируйся и сразу переходи к игре.'), Lang.native('Создать аккаунт и войти')], password: [Lang.native('Новый пароль'), Lang.native('Защити свой аккаунт. Пароль не сохраняется в лаунчере.'), Lang.native('Сохранить пароль')], skin: [Lang.native('Твой скин'), Lang.native('Загрузи PNG — скин сразу применится. Ник персонажа изменить нельзя.'), Lang.native('Загрузить скин')], reset: [Lang.native('Вернёмся в игру'), Lang.native('Восстанови доступ к своему аккаунту KRWA.'), Lang.native('Отправить письмо')] }

function nativeMessage(text, error = false) {
    nativeStatus.textContent = text
    nativeStatus.dataset.error = String(error)
}
function nativeSetBusy(busy) {
    nativeBusy = busy
    for (const control of nativeForm.querySelectorAll('input,select,button')) control.disabled = busy
    document.getElementById('nativeAccountBack').disabled = busy
    for (const control of document.querySelectorAll('#nativeAccountNav button')) control.disabled = busy
    nativeSubmit.textContent = busy ? Lang.native('Подожди немного…') : nativeCompletion ? Lang.native('Перейти ко входу') : nativeResetConfirm ? Lang.native('Сохранить новый пароль') : nativeLabels[nativeMode][2]
}
async function nativeRefreshCaptcha(serial = nativeViewSerial) {
    const result = await NativeAccountAPI.captcha()
    if (serial !== nativeViewSerial) return
    if (!/^image\/(png|jpeg)$/.test(result.mime) || !/^[\w+/=]+$/.test(result.image_base64)) throw new Error(Lang.native('Не удалось загрузить код проверки.'))
    nativeCaptchaId = result.challenge_id
    document.getElementById('nativeCaptchaImage').src = `data:${result.mime};base64,${result.image_base64}`
    nativeField('captchaAnswer').value = ''
    document.getElementById('nativeCaptcha').hidden = false
}
async function openNativeAccount(mode = 'skin') {
    if (nativeBusy || !nativeLabels[mode]) return
    const selected = ConfigManager.getSelectedAccount()
    if (['skin', 'password'].includes(mode) && !selected) {
        nativeMessage(Lang.native('Сначала войди в аккаунт.'))
        switchView(getCurrentView(), VIEWS.login, 150, 150)
        return
    }
    if (getCurrentView() !== VIEWS.account) nativeReturn = getCurrentView()
    nativeMode = mode
    nativeResetConfirm = false
    nativeCompletion = false
    nativeCaptchaId = null
    const serial = ++nativeViewSerial
    nativeForm.reset()
    for (const input of nativeForm.querySelectorAll('[autocomplete$="password"]')) input.type = 'password'
    for (const eye of nativeForm.querySelectorAll('.native-eye')) eye.setAttribute('aria-label', Lang.native('Показать пароль'))
    for (const panel of nativeForm.querySelectorAll('.native-panel')) panel.hidden = true
    document.getElementById(`native${{ register: 'Register', password: 'Password', skin: 'Skin', reset: 'Reset' }[mode]}Fields`).hidden = false
    document.getElementById('nativeResetConfirmFields').hidden = true
    nativeField('resetEmail').parentElement.hidden = false
    document.getElementById('nativeHaveResetCode').textContent = Lang.native('У меня уже есть ссылка из письма')
    document.getElementById('nativeCaptcha').hidden = true
    document.getElementById('nativeAccountNav').hidden = !['skin', 'password'].includes(mode)
    for (const button of document.querySelectorAll('#nativeAccountNav button')) button.classList.toggle('active', button.dataset.nativeAccount === mode)
    document.getElementById('nativeAccountHeading').textContent = nativeLabels[mode][0]
    document.getElementById('nativeAccountIntro').textContent = nativeLabels[mode][1]
    document.getElementById('nativePasswordAccount').textContent = selected?.displayName || ''
    document.getElementById('nativeSkinAccount').textContent = selected?.displayName || ''
    document.getElementById('nativeFileName').textContent = Lang.native('Загрузить скин')
    nativeSubmit.hidden = mode === 'skin'
    document.getElementById('nativeSkinPreview').getContext('2d').clearRect(0, 0, 160, 240)
    document.getElementById('nativePreviewHint').textContent = Lang.native('Выбери скин для предпросмотра')
    if (nativePreviewURL) { window.URL.revokeObjectURL(nativePreviewURL); nativePreviewURL = null }
    nativeMessage('')
    nativeSetBusy(false)
    if (getCurrentView() !== VIEWS.account) switchView(getCurrentView(), VIEWS.account, 150, 150)
    document.querySelector('.native-account-main').scrollTop = 0
    if (mode === 'skin') {
        require('./assets/js/yggdrasilapi').getSkinUrl(selected.uuid).then(url => {
            if (url && serial === nativeViewSerial && !nativeField('textureFile').files[0]) nativePreview(url)
        }).catch(() => {})
    }
    if (['register', 'password'].includes(mode)) {
        try {
            const policy = await NativeAccountAPI.policy()
            if (serial !== nativeViewSerial) return
            if (mode === 'register' ? policy.register_required : policy.login_required) await nativeRefreshCaptcha(serial)
        } catch (error) { if (serial === nativeViewSerial) nativeMessage(error.message, true) }
    }
}
function nativeBack(target = nativeReturn) {
    if (nativeBusy) return
    ++nativeViewSerial
    nativeForm.reset()
    if (nativePreviewURL) { window.URL.revokeObjectURL(nativePreviewURL); nativePreviewURL = null }
    switchView(VIEWS.account, target, 150, 150)
}
document.getElementById('nativeAccountBack').onclick = () => nativeBack()
document.getElementById('nativeGoLogin').onclick = () => nativeBack(VIEWS.login)
document.getElementById('nativeCaptchaRefresh').onclick = () => nativeRefreshCaptcha().catch(error => nativeMessage(error.message, true))
document.getElementById('nativeHaveResetCode').onclick = () => {
    nativeResetConfirm = !nativeResetConfirm
    document.getElementById('nativeResetConfirmFields').hidden = !nativeResetConfirm
    nativeField('resetEmail').parentElement.hidden = nativeResetConfirm
    nativeSubmit.textContent = nativeResetConfirm ? Lang.native('Сохранить новый пароль') : nativeLabels.reset[2]
    document.getElementById('nativeHaveResetCode').textContent = nativeResetConfirm ? Lang.native('Отправить новое письмо') : Lang.native('У меня уже есть ссылка из письма')
    nativeMessage('')
}
for (const eye of nativeForm.querySelectorAll('.native-eye')) eye.onclick = () => {
    const input = eye.previousElementSibling
    input.type = input.type === 'password' ? 'text' : 'password'
    eye.setAttribute('aria-label', input.type === 'password' ? Lang.native('Показать пароль') : Lang.native('Скрыть пароль'))
}
function nativePassword(password, confirm) {
    if ([...password].length < 8 || [...password].length > 128) throw new Error(Lang.native('Пароль должен содержать от 8 до 128 символов.'))
    if (password !== confirm) throw new Error(Lang.native('Пароли не совпадают.'))
}
async function nativeEnterGame(identifier, password) {
    const account = await AuthManager.addMojangAccount(identifier, password)
    updateSelectedAccount(account)
    await prepareSettings()
}
nativeForm.onsubmit = async event => {
    event.preventDefault()
    if (nativeBusy) return
    if (nativeCompletion) { nativeBack(VIEWS.login); return }
    const value = name => nativeField(name).value
    const selected = ConfigManager.getSelectedAccount()
    const captcha = nativeCaptchaId ? { captcha_challenge_id: nativeCaptchaId, captcha_answer: value('captchaAnswer').trim() } : {}
    nativeMessage('')
    let accountCreated = false, passwordChanged = false
    try {
        if (nativeMode === 'register') {
            if (!/^[a-zA-Z0-9_]{4,16}$/.test(value('nickname'))) throw new Error(Lang.native('Ник: от 4 до 16 латинских букв, цифр или _.'))
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) throw new Error(Lang.native('Укажи корректную почту.'))
            nativePassword(value('registerPassword'), value('registerConfirm'))
            if (!nativeField('terms').checked) throw new Error(Lang.native('Прими правила и политику конфиденциальности.'))
        }
        if (nativeMode === 'password') {
            if (!selected || !value('currentPassword')) throw new Error(Lang.native('Введи текущий пароль аккаунта.'))
            nativePassword(value('newPassword'), value('newConfirm'))
        }
        if (nativeMode === 'reset') {
            if (nativeResetConfirm) nativePassword(value('resetPassword'), value('resetConfirm'))
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('resetEmail'))) throw new Error(Lang.native('Укажи корректную почту.'))
        }
        nativeSetBusy(true)
        if (nativeMode === 'register') {
            const result = await NativeAccountAPI.register({ username: value('nickname'), email: value('email').trim(), password: value('registerPassword'), ...captcha })
            accountCreated = true
            if (result.requires_activation) {
                nativeForm.reset()
                nativeCompletion = true
                nativeMessage(Lang.native('Аккаунт создан. Подтверди почту по ссылке из письма, затем войди в лаунчер.'))
            } else {
                await nativeEnterGame(value('nickname'), value('registerPassword'))
                nativeSetBusy(false)
                nativeBack(VIEWS.landing)
            }
        } else if (nativeMode === 'password') {
            await NativeAccountAPI.changePassword(selected.username, value('currentPassword'), value('newPassword'), captcha)
            passwordChanged = true
            await nativeEnterGame(selected.username, value('newPassword'))
            nativeForm.reset()
            nativeMessage(Lang.native('Пароль изменён. Ты снова в аккаунте — можно играть.'))
        } else if (nativeMode === 'skin') {
            const file = nativeField('textureFile').files[0]
            if (!file || !selected) throw new Error(Lang.native('Выбери PNG-файл и игровой аккаунт.'))
            if (file.size > 2 * 1024 * 1024) throw new Error(Lang.native('Нужен PNG-файл размером до 2 МБ.'))
            const bytes = Buffer.from(await file.arrayBuffer())
            require('./assets/js/accountapi').validateSkinBytes(bytes)
            const image = await createImageBitmap(file).catch(() => { throw new Error(Lang.native('Не удалось прочитать PNG-файл. Выбери другой скин.')) })
            let model
            try { model = NativeSkinPreview.prepareSkin(image, document.createElement('canvas')) }
            finally { image.close() }
            await NativeAccountAPI.upload({ uuid: selected.uuid, accessToken: selected.accessToken, type: 'skin', model, bytes })
            await nativePreviewFile(file)
            nativeField('textureFile').value = ''
            nativeMessage(Lang.native('Скин обновлён. Перезайди на сервер, чтобы увидеть новый образ.'))
            updateSelectedAccount(selected)
        } else if (nativeResetConfirm) {
            let token = value('resetToken').trim()
            try { token = new URL(token).searchParams.get('token') || token } catch { /* A raw token is also supported. */ }
            if (!token) throw new Error(Lang.native('Вставь ссылку или код из письма.'))
            await NativeAccountAPI.resetConfirm(token, value('resetPassword'))
            nativeForm.reset()
            nativeCompletion = true
            nativeMessage(Lang.native('Пароль изменён. Вернись ко входу и используй новый пароль.'))
        } else {
            await NativeAccountAPI.resetRequest(value('resetEmail').trim())
            nativeMessage(Lang.native('Запрос принят. Если сброс доступен, письмо придёт на указанную почту.'))
        }
    } catch (error) {
        if (accountCreated || passwordChanged) {
            nativeForm.reset()
            nativeCompletion = true
            nativeMessage(accountCreated ? Lang.native('Аккаунт создан. Автоматический вход не удался — открой «Вход» и используй свой пароль.') : Lang.native('Пароль изменён. Войди в лаунчер заново с новым паролем.'), true)
        } else nativeMessage(error.message || error.desc || Lang.native('Не удалось выполнить действие. Попробуй ещё раз.'), true)
        if (nativeCaptchaId && !accountCreated && !passwordChanged) await nativeRefreshCaptcha().catch(() => {})
    } finally {
        if (nativeMode === 'skin') nativeField('textureFile').value = ''
        nativeSetBusy(false)
    }
}
async function nativePreviewFile(file) {
    const image = await createImageBitmap(file)
    try {
        const skin = document.createElement('canvas')
        const model = NativeSkinPreview.prepareSkin(image, skin)
        NativeSkinPreview.drawSkin(document.getElementById('nativeSkinPreview').getContext('2d'), skin, model)
        document.getElementById('nativePreviewHint').textContent = Lang.native('Твой текущий скин')
    } finally { image.close() }
}
async function nativePreview(source) {
    if (typeof source !== 'string' || !/^https?:\/\//.test(source)) return
    const serial = nativeViewSerial
    try {
        const response = await fetch(source)
        if (!response.ok) return
        const file = await response.blob()
        if (serial === nativeViewSerial && !nativeBusy && !nativeField('textureFile').files[0]) await nativePreviewFile(file)
    } catch { /* Keep the upload control available when the current skin cannot be fetched. */ }
}
nativeField('textureFile').onchange = () => {
    if (nativeField('textureFile').files[0] && !nativeBusy) nativeForm.requestSubmit()
}
