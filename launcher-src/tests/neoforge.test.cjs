const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { isNeoForgeProfile, syncNeoForgeMods } = require('../app/assets/js/neoforgemods')

test('detects a NeoForge profile from its version manifest', () => {
    assert.equal(isNeoForgeProfile({ modules: [] }, { id: 'neoforge-21.1.248' }), true)
    assert.equal(isNeoForgeProfile({ modules: [] }, { id: 'fabric-loader-0.19.5-1.21.1' }), false)
})

test('syncs managed NeoForge mods without deleting user files', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-neoforge-'))
    t.after(() => fs.rmSync(root, { recursive: true }))
    const source = path.join(root, 'new-mod.jar')
    const modsDir = path.join(root, 'instance', 'mods')
    fs.mkdirSync(modsDir, { recursive: true })
    fs.writeFileSync(source, 'new')
    fs.writeFileSync(path.join(modsDir, 'old-managed.jar'), 'old')
    fs.writeFileSync(path.join(modsDir, 'user-added.jar'), 'user')
    fs.writeFileSync(path.join(root, 'instance', '.krwa-neoforge-mods.json'), JSON.stringify({ files: ['old-managed.jar'] }))

    syncNeoForgeMods(path.join(root, 'instance'), [{ getPath: () => source }])

    assert.equal(fs.existsSync(path.join(modsDir, 'old-managed.jar')), false)
    assert.equal(fs.readFileSync(path.join(modsDir, 'new-mod.jar'), 'utf8'), 'new')
    assert.equal(fs.readFileSync(path.join(modsDir, 'user-added.jar'), 'utf8'), 'user')
})
