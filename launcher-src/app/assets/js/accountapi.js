const got = require('got')
const FormData = require('form-data')
const { YGGDRASIL_API_ROOT } = require('./ipcconstants')

function validateSkinBytes(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024 || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Нужен PNG-файл размером до 2 МБ.')
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    if (width < 64 || width % 64 || width * height > 4096 * 4096 || ![width, width / 2].includes(height)) throw new Error('Нужен скин Minecraft: 64 × 64, 64 × 32 или их HD-вариант до 4096 × 4096.')
}

// Native client: short-lived web credentials stay in this module and are never saved.
function createAccountAPI(root = YGGDRASIL_API_ROOT) {
    const origin = new URL(root).origin
    const client = got.extend({ prefixUrl: origin, retry: { limit: 0 }, timeout: { request: 15000 }, throwHttpErrors: false, followRedirect: false })
    async function request(route, options = {}) {
        let response
        try { response = await client(route, options) }
        catch { throw new Error('Не удалось связаться с KRWA. Проверь подключение и попробуй ещё раз.') }
        let body = {}
        try { body = response.body ? JSON.parse(response.body) : {} } catch { /* Non-JSON proxy failure. */ }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const code = body.error?.code || body.code || ''
            let message = body.msg || body.errorMessage || 'Сервис временно недоступен. Попробуй ещё раз.'
            if (response.statusCode === 401) message = 'Неверный пароль или срок входа истёк. Войди в аккаунт ещё раз.'
            if (response.statusCode === 429) message = 'Слишком много попыток. Подожди немного и повтори.'
            if (/captcha/i.test(code)) message = 'Проверь код с картинки. Если он устарел, обнови картинку.'
            if (/username.*(exist|taken)/i.test(code + message)) message = 'Этот ник уже занят. Выбери другой.'
            if (/email.*(exist|taken)/i.test(code + message)) message = 'Эта почта уже зарегистрирована. Попробуй войти.'
            const error = new Error(message)
            error.statusCode = response.statusCode
            throw error
        }
        return { data: body.data, headers: response.headers }
    }
    function cookie(response, name) {
        return response.headers['set-cookie']?.find(value => value.startsWith(name + '='))?.split(';')[0].slice(name.length + 1)
    }
    async function revoke(response) {
        const refresh = cookie(response, 'aster_refresh')
        if (refresh) await request('api/v1/auth/logout', { method: 'POST', json: { refresh_token: refresh } }).catch(() => {})
    }
    return {
        policy: async () => (await request('api/v1/auth/captcha/policy')).data,
        captcha: async () => (await request('api/v1/auth/captcha', { method: 'POST' })).data,
        register: async data => {
            const response = await request('api/v1/auth/register', { method: 'POST', json: data })
            await revoke(response)
            return response.data
        },
        resetRequest: async email => { await request('api/v1/auth/password/reset/request', { method: 'POST', json: { email } }) },
        resetConfirm: async (token, password) => { await request('api/v1/auth/password/reset/confirm', { method: 'POST', json: { token, new_password: password } }) },
        changePassword: async (identifier, currentPassword, newPassword, captcha = {}) => {
            const login = await request('api/v1/auth/login', { method: 'POST', json: { identifier, password: currentPassword, ...captcha } })
            const access = cookie(login, 'aster_access')
            if (!access) { await revoke(login); throw new Error('Не удалось подтвердить аккаунт. Попробуй войти ещё раз.') }
            try {
                const changed = await request('api/v1/auth/password', { method: 'PUT', headers: { authorization: `Bearer ${access}` }, json: { current_password: currentPassword, new_password: newPassword } })
                await revoke(changed)
            } finally { await revoke(login) }
        },
        upload: async ({ uuid, accessToken, type = 'skin', model, bytes }) => {
            const id = String(uuid).replace(/-/g, '')
            if (!/^[a-f0-9]{32}$/i.test(id) || type !== 'skin') throw new Error('Выбери игровой аккаунт.')
            validateSkinBytes(bytes)
            const form = new FormData()
            if (type === 'skin') form.append('model', model === 'slim' ? 'slim' : '')
            form.append('file', bytes, { filename: `${type}.png`, contentType: 'image/png' })
            const route = new URL(`api/user/profile/${id}/${type}`, root).pathname.slice(1)
            await request(route, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}` }, body: form })
        }
    }
}
exports.createAccountAPI = createAccountAPI
exports.validateSkinBytes = validateSkinBytes
