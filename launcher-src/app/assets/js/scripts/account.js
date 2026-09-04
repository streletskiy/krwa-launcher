const NativeAccountAPI = require('./assets/js/accountapi').createAccountAPI()
const nativeForm = document.getElementById('nativeAccountForm')
const nativeStatus = document.getElementById('nativeAccountStatus')
const nativeSubmit = document.getElementById('nativeAccountSubmit')
let nativeMode = 'register', nativeBusy = false, nativeReturn = VIEWS.login, nativeCaptchaId = null, nativeResetConfirm = false, nativePreviewURL = null, nativeViewSerial = 0
let nativeCompletion = false
const nativeField = name => nativeForm.elements.namedItem(name)
const nativeLabels = { register: ['Создай свой аккаунт', 'Выбери ник, зарегистрируйся и сразу переходи к игре.', 'Создать аккаунт и войти'], password: ['Новый пароль', 'Защити свой аккаунт. Пароль не сохраняется в лаунчере.', 'Сохранить пароль'], skin: ['Твой персонаж', 'Выбери образ, который увидят другие игроки.', 'Загрузить и надеть'], reset: ['Вернёмся в игру', 'Восстанови доступ к своему аккаунту KRWA.', 'Отправить письмо'] }

function nativeMessage(text, error = false) {
    nativeStatus.textContent = text
    nativeStatus.dataset.error = String(error)
}
function nativeSetBusy(busy) {
    nativeBusy = busy
    for (const control of nativeForm.querySelectorAll('input,select,button')) control.disabled = busy
    document.getElementById('nativeAccountBack').disabled = busy
    for (const control of document.querySelectorAll('#nativeAccountNav button')) control.disabled = busy
    nativeSubmit.textContent = busy ? 'Подожди немного…' : nativeCompletion ? 'Перейти ко входу' : nativeResetConfirm ? 'Сохранить новый пароль' : nativeLabels[nativeMode][2]
}
async function nativeRefreshCaptcha(serial = nativeViewSerial) {
    const result = await NativeAccountAPI.captcha()
    if (serial !== nativeViewSerial) return
    if (!/^image\/(png|jpeg)$/.test(result.mime) || !/^[\w+/=]+$/.test(result.image_base64)) throw new Error('Не удалось загрузить код проверки.')
    nativeCaptchaId = result.challenge_id
    document.getElementById('nativeCaptchaImage').src = `data:${result.mime};base64,${result.image_base64}`
    nativeField('captchaAnswer').value = ''
    document.getElementById('nativeCaptcha').hidden = false
}
async function openNativeAccount(mode = 'skin') {
    if (nativeBusy || !nativeLabels[mode]) return
    const selected = ConfigManager.getSelectedAccount()
    if (['skin', 'password'].includes(mode) && !selected) {
        nativeMessage('Сначала войди в аккаунт.')
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
    for (const eye of nativeForm.querySelectorAll('.native-eye')) eye.setAttribute('aria-label', 'Показать пароль')
    for (const panel of nativeForm.querySelectorAll('.native-panel')) panel.hidden = true
    document.getElementById(`native${{ register: 'Register', password: 'Password', skin: 'Skin', reset: 'Reset' }[mode]}Fields`).hidden = false
    document.getElementById('nativeResetConfirmFields').hidden = true
    nativeField('resetEmail').parentElement.hidden = false
    document.getElementById('nativeHaveResetCode').textContent = 'У меня уже есть ссылка из письма'
    document.getElementById('nativeCaptcha').hidden = true
    document.getElementById('nativeAccountNav').hidden = !['skin', 'password'].includes(mode)
    for (const button of document.querySelectorAll('#nativeAccountNav button')) button.classList.toggle('active', button.dataset.nativeAccount === mode)
    document.getElementById('nativeAccountHeading').textContent = nativeLabels[mode][0]
    document.getElementById('nativeAccountIntro').textContent = nativeLabels[mode][1]
    document.getElementById('nativePasswordAccount').textContent = selected?.displayName || ''
    document.getElementById('nativeSkinAccount').textContent = selected?.displayName || ''
    document.getElementById('nativeFileName').textContent = 'Выбрать файл'
    document.getElementById('nativeModelLabel').hidden = false
    document.getElementById('nativeFileHint').textContent = 'Скин: 64 × 64 или 64 × 32. PNG до 2 МБ.'
    document.getElementById('nativeSkinPreview').getContext('2d').clearRect(0, 0, 160, 240)
    document.getElementById('nativePreviewHint').textContent = 'Выбери скин для предпросмотра'
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
    nativeSubmit.textContent = nativeResetConfirm ? 'Сохранить новый пароль' : nativeLabels.reset[2]
    document.getElementById('nativeHaveResetCode').textContent = nativeResetConfirm ? 'Отправить новое письмо' : 'У меня уже есть ссылка из письма'
    nativeMessage('')
}
for (const eye of nativeForm.querySelectorAll('.native-eye')) eye.onclick = () => {
    const input = eye.previousElementSibling
    input.type = input.type === 'password' ? 'text' : 'password'
    eye.setAttribute('aria-label', input.type === 'password' ? 'Показать пароль' : 'Скрыть пароль')
}
function nativePassword(password, confirm) {
    if ([...password].length < 8 || [...password].length > 128) throw new Error('Пароль должен содержать от 8 до 128 символов.')
    if (password !== confirm) throw new Error('Пароли не совпадают.')
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
            if (!/^[a-zA-Z0-9_]{3,16}$/.test(value('nickname'))) throw new Error('Ник: от 3 до 16 латинских букв, цифр или _.')
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) throw new Error('Укажи корректную почту.')
            nativePassword(value('registerPassword'), value('registerConfirm'))
            if (!nativeField('terms').checked) throw new Error('Прими правила и политику конфиденциальности.')
        }
        if (nativeMode === 'password') {
            if (!selected || !value('currentPassword')) throw new Error('Введи текущий пароль аккаунта.')
            nativePassword(value('newPassword'), value('newConfirm'))
        }
        if (nativeMode === 'reset') {
            if (nativeResetConfirm) nativePassword(value('resetPassword'), value('resetConfirm'))
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('resetEmail'))) throw new Error('Укажи корректную почту.')
        }
        nativeSetBusy(true)
        if (nativeMode === 'register') {
            const result = await NativeAccountAPI.register({ username: value('nickname'), email: value('email').trim(), password: value('registerPassword'), ...captcha })
            accountCreated = true
            if (result.requires_activation) {
                nativeForm.reset()
                nativeCompletion = true
                nativeMessage('Аккаунт создан. Подтверди почту по ссылке из письма, затем войди в лаунчер.')
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
            nativeMessage('Пароль изменён. Ты снова в аккаунте — можно играть.')
        } else if (nativeMode === 'skin') {
            const file = nativeField('textureFile').files[0]
            if (!file || !selected) throw new Error('Выбери PNG-файл и игровой аккаунт.')
            const bytes = Buffer.from(await file.arrayBuffer())
            await NativeAccountAPI.upload({ uuid: selected.uuid, accessToken: selected.accessToken, type: value('textureType'), model: value('skinModel'), bytes })
            nativeMessage(value('textureType') === 'skin' ? 'Скин надет. Перезайди на сервер, чтобы увидеть новый образ.' : 'Плащ надет. Перезайди на сервер, чтобы увидеть его.')
            updateSelectedAccount(selected)
        } else if (nativeResetConfirm) {
            let token = value('resetToken').trim()
            try { token = new URL(token).searchParams.get('token') || token } catch { /* A raw token is also supported. */ }
            if (!token) throw new Error('Вставь ссылку или код из письма.')
            await NativeAccountAPI.resetConfirm(token, value('resetPassword'))
            nativeForm.reset()
            nativeCompletion = true
            nativeMessage('Пароль изменён. Вернись ко входу и используй новый пароль.')
        } else {
            await NativeAccountAPI.resetRequest(value('resetEmail').trim())
            nativeMessage('Запрос принят. Если сброс доступен, письмо придёт на указанную почту.')
        }
    } catch (error) {
        if (accountCreated || passwordChanged) {
            nativeForm.reset()
            nativeCompletion = true
            nativeMessage(accountCreated ? 'Аккаунт создан. Автоматический вход не удался — открой «Вход» и используй свой пароль.' : 'Пароль изменён. Войди в лаунчер заново с новым паролем.', true)
        } else nativeMessage(error.message || error.desc || 'Не удалось выполнить действие. Попробуй ещё раз.', true)
        if (nativeCaptchaId && !accountCreated && !passwordChanged) await nativeRefreshCaptcha().catch(() => {})
    } finally { nativeSetBusy(false) }
}
async function nativePreview(source) {
    const file = nativeField('textureFile').files[0]
    const currentSkin = typeof source === 'string' && /^https?:\/\//.test(source) ? source : null
    const canvas = document.getElementById('nativeSkinPreview'), ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (nativePreviewURL) window.URL.revokeObjectURL(nativePreviewURL)
    nativePreviewURL = null
    if (!file && !currentSkin) return
    if (file) document.getElementById('nativeFileName').textContent = file.name
    if (file && (file.size > 2 * 1024 * 1024 || !/\.png$/i.test(file.name))) { nativeMessage('Выбери PNG-файл размером до 2 МБ.', true); return }
    const type = nativeField('textureType').value
    const img = new Image(), url = currentSkin || window.URL.createObjectURL(file)
    nativePreviewURL = url
    img.onload = () => {
        if (url !== nativePreviewURL) return
        ctx.imageSmoothingEnabled = false
        if (type === 'skin' && img.width === 64 && [32, 64].includes(img.height)) {
            const scale = 6, x = 56, y = 24, slim = nativeField('skinModel').value === 'slim', arm = slim ? 3 : 4
            const draw = (sx, sy, w, h, dx, dy) => ctx.drawImage(img, sx, sy, w, h, dx, dy, w * scale, h * scale)
            draw(8, 8, 8, 8, x, y); draw(40, 8, 8, 8, x, y)
            draw(20, 20, 8, 12, x, y + 48)
            draw(44, 20, arm, 12, x - arm * scale, y + 48)
            draw(img.height === 64 ? 36 : 44, img.height === 64 ? 52 : 20, arm, 12, x + 48, y + 48)
            draw(4, 20, 4, 12, x, y + 120)
            draw(img.height === 64 ? 20 : 4, img.height === 64 ? 52 : 20, 4, 12, x + 24, y + 120)
        } else if (type === 'cape' && img.width === 64 && img.height === 32) ctx.drawImage(img, 1, 1, 10, 16, 40, 32, 80, 128)
        else { nativeMessage(type === 'skin' ? 'Размер скина: 64 × 64 или 64 × 32.' : 'Размер плаща: 64 × 32.', true); return }
        document.getElementById('nativePreviewHint').textContent = type === 'skin' ? 'Так будет выглядеть твой персонаж' : 'Предпросмотр плаща'
        nativeMessage('')
    }
    img.onerror = () => { if (url === nativePreviewURL) nativeMessage('Не удалось прочитать PNG-файл.', true) }
    img.src = url
}
nativeField('textureFile').onchange = nativePreview
nativeField('skinModel').onchange = nativePreview
nativeField('textureType').onchange = () => {
    const skin = nativeField('textureType').value === 'skin'
    document.getElementById('nativeModelLabel').hidden = !skin
    document.getElementById('nativeFileHint').textContent = skin ? 'Скин: 64 × 64 или 64 × 32. PNG до 2 МБ.' : 'Плащ: 64 × 32. PNG до 2 МБ.'
    nativePreview()
}
