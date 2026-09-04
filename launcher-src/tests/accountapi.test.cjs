const test = require('node:test')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createAccountAPI } = require('../app/assets/js/accountapi')

test('password change uses an ephemeral web token and revokes both temporary sessions', async () => {
    const requests = []
    const server = createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk
        const body = JSON.parse(raw || '{}'); requests.push({ route: req.url, body })
        if (req.url.endsWith('/login')) res.setHeader('Set-Cookie', ['aster_access=temporary-access; HttpOnly', 'aster_refresh=temporary-refresh; HttpOnly'])
        if (req.url.endsWith('/password')) {
            assert.equal(req.headers.authorization, 'Bearer temporary-access')
            assert.equal(req.headers.cookie, undefined)
            assert.equal(body.current_password, 'old-password')
            res.setHeader('Set-Cookie', 'aster_refresh=new-refresh; HttpOnly')
        }
        res.end(JSON.stringify({ data: {} }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
        await createAccountAPI(`http://127.0.0.1:${server.address().port}/api/yggdrasil/`).changePassword('player', 'old-password', 'new-password')
        assert.deepEqual(requests.filter(r => r.route.endsWith('/logout')).map(r => r.body.refresh_token), ['new-refresh', 'temporary-refresh'])
    } finally { server.close() }
})
test('texture upload rejects malformed profile IDs and non-PNG content before requesting', async () => {
    const api = createAccountAPI('http://127.0.0.1:1/api/yggdrasil/')
    await assert.rejects(api.upload({ uuid: '../admin', type: 'skin', bytes: Buffer.alloc(24) }), /аккаунт/)
    await assert.rejects(api.upload({ uuid: 'a'.repeat(32), type: 'skin', bytes: Buffer.alloc(24) }), /PNG/)
})
