;(() => {
    const got = require('got')
    const QRCode = require('qrcode')
    const { YGGDRASIL_API_ROOT } = require('./assets/js/ipcconstants')
    const origin = new URL(YGGDRASIL_API_ROOT).origin
    const endpoint = origin + '/api/v1/launcher-device/'
    const el = id => document.getElementById(id)
    const dialog = el('deviceDialog')
    let controller
    async function begin() {
        controller?.abort()
        controller = new AbortController()
        const { signal } = controller
        const msg = el('device-message'), canvas = el('device-qr')
        el('device-retry').hidden = canvas.hidden = true
        el('device-code').textContent = ''
        msg.textContent = Lang.native('Создаём код…')
        const post = (part, json) => got.post(endpoint + part, { json, signal, throwHttpErrors: false, followRedirect: false, retry: 0, timeout: { request: 12000 } })
        try {
            const clientToken = ConfigManager.getClientToken() || require('node:crypto').randomUUID()
            const response = await post('start', { client_token: clientToken })
            if (response.statusCode !== 200) throw Error()
            const grant = JSON.parse(response.body)
            if (![grant.code, grant.secret].every(v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v))) throw Error()
            await QRCode.toCanvas(canvas, origin + '/device?code=' + grant.code, { width: 180, margin: 4, errorCorrectionLevel: 'M' })
            if (signal.aborted) return
            canvas.hidden = false
            el('device-code').textContent = grant.code.slice(-6).toUpperCase()
            msg.textContent = Lang.native('Сканируйте код телефоном и подтвердите вход.')
            const end = Date.now() + Math.min(grant.expires_in, 600) * 1000
            let failure = 'Код истёк. Запросите новый.'
            while (!signal.aborted && Date.now() < end) {
                await new Promise(resolve => setTimeout(resolve, 4000))
                if (signal.aborted) return
                const result = await post('poll', { code: grant.code, secret: grant.secret })
                if (result.statusCode === 202) continue
                if (result.statusCode === 403) failure = 'Вход отклонён на телефоне.'
                if (result.statusCode === 410 || result.statusCode === 403) break
                if (result.statusCode !== 200) throw Error()
                const session = JSON.parse(result.body), profile = session.selectedProfile
                if (!session.accessToken || session.clientToken !== clientToken || !profile?.id || !profile.name) throw Error()
                const account = ConfigManager.addMojangAuthAccount(profile.id, session.accessToken, profile.name, profile.name)
                ConfigManager.setClientToken(clientToken)
                ConfigManager.save()
                window.krwaSessionUnavailable = false
                updateSelectedAccount(account)
                dialog.close()
                const next = loginViewOnSuccess
                switchView(VIEWS.login, next, 500, 500, async () => {
                    if (next === VIEWS.settings) await prepareSettings()
                    loginViewOnSuccess = VIEWS.landing
                    loginCancelEnabled(false)
                    loginViewCancelHandler = null
                    loginPassword.value = ''
                })
                return
            }
            msg.textContent = Lang.native(failure)
        } catch {
            if (signal.aborted) return
            msg.textContent = Lang.native('Не удалось связаться с порталом.')
        }
        if (!signal.aborted) {
            canvas.hidden = true
            el('device-code').textContent = ''
            el('device-retry').hidden = false
            el('device-retry').focus()
        }
    }
    el('login-qr').onclick = () => { dialog.showModal(); el('device-close').focus(); begin() }
    el('device-close').onclick = () => dialog.close()
    el('device-retry').onclick = begin
    dialog.addEventListener('close', () => { controller?.abort(); el('login-qr').focus() })
})()
