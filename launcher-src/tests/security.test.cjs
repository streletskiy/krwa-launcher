const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
    atomicWriteFileSync,
    createPrivateTempDirectory,
    resolveArchiveEntry
} = require('../app/assets/js/filesystemutil')
const { getProfile, validateSession } = require('../app/assets/js/yggdrasilapi')

test('archive extraction paths stay inside their private root', t => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-security-'))
    t.after(() => fs.rmSync(parent, { recursive: true }))
    const root = createPrivateTempDirectory(parent)

    assert.equal(resolveArchiveEntry(root, 'nested/native.dll'), path.join(root, 'nested', 'native.dll'))
    assert.equal(resolveArchiveEntry(root, 'nested/native.dll', true), path.join(root, 'native.dll'))
    for(const malicious of ['../outside.dll', '..\\outside.dll', '/outside.dll', 'C:\\outside.dll', 'nested/../../outside.dll']) {
        assert.throws(() => resolveArchiveEntry(root, malicious), /escapes/)
        assert.throws(() => resolveArchiveEntry(root, malicious, true), /escapes/)
    }
})

test('atomic writes replace a file and do not leave temporary siblings', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-atomic-'))
    t.after(() => fs.rmSync(root, { recursive: true }))
    const file = path.join(root, 'config.json')
    fs.writeFileSync(file, 'old')

    atomicWriteFileSync(file, 'new', 'utf8')

    assert.equal(fs.readFileSync(file, 'utf8'), 'new')
    assert.deepEqual(fs.readdirSync(root), ['config.json'])
})

test('authentication sessions are bounded and normalized before persistence', () => {
    const valid = validateSession({
        accessToken: 'signed.token-value',
        clientToken: 'client-token',
        selectedProfile: { id: '01234567-89ab-cdef-0123-456789abcdef', name: 'Player_1' }
    })
    assert.equal(valid.selectedProfile.id, '0123456789abcdef0123456789abcdef')
    assert.throws(() => validateSession({ accessToken: 'ok', clientToken: 'ok', selectedProfile: { id: '../admin', name: '<img>' } }), /invalid profile/)
    assert.throws(() => validateSession({ accessToken: `ok\nmalicious`, clientToken: 'ok' }), /access token/)
    assert.throws(() => validateSession({ accessToken: 'x'.repeat(8193), clientToken: 'ok' }), /access token/)
})

test('profile requests reject path-like identifiers before making a request', async () => {
    await assert.rejects(getProfile('../admin'), /Invalid profile ID/)
})

test('release notes use text-only rendering and the KRWA release feed', () => {
    const settings = fs.readFileSync(path.join(__dirname, '../app/assets/js/scripts/settings.js'), 'utf8')
    assert.ok(settings.includes('https://github.com/streletskiy/krwa-launcher/releases.atom'))
    assert.ok(settings.includes('settingsAboutChangelogTitle.textContent'))
    assert.ok(settings.includes('settingsAboutChangelogText.textContent'))
    assert.ok(!settings.includes('settingsAboutChangelogText.innerHTML'))
})
