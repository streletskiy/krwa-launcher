const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { HeliosDistribution } = require('helios-core/common')
const { DistributionIndexProcessor } = require('helios-core/dl')
const { UserSettingsPreserver, isUserSettingsPath } = require('../app/assets/js/usersettings')

const hash = value => crypto.createHash('md5').update(value).digest('hex')
const quiet = { info() {}, warn() {} }

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-settings-test-'))
    const common = path.join(root, 'common')
    const instances = path.join(root, 'instances')
    const gameDir = path.join(instances, 'test')
    fs.mkdirSync(gameDir, { recursive: true })
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
        fs.rmSync(root, { recursive: true, force: true })
    })
    const write = (relativePath, data) => {
        const file = path.join(gameDir, relativePath)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, data)
    }
    const make = (files, version = '1', untrackedPaths = []) => {
        const distribution = new HeliosDistribution({ servers: [{ id: 'test', version, address: 'localhost:25565', minecraftVersion: '1.21.1', modules: Object.entries(files).map(([relativePath, data]) => ({
            id: path.basename(relativePath), name: path.basename(relativePath), type: 'File',
            artifact: { path: relativePath, size: Buffer.byteLength(data), MD5: untrackedPaths.includes(relativePath) ? undefined : hash(data), url: `https://example.com/${relativePath}` }
        })) }] }, common, instances)
        const server = distribution.getServerById('test')
        const preserver = new UserSettingsPreserver(gameDir, server, quiet)
        t.after(() => preserver.dispose())
        const invalid = async () => {
            const processor = new DistributionIndexProcessor(common, distribution, 'test')
            return (await processor.validate(async () => {})).distribution
        }
        return { preserver, invalid }
    }
    return { root, gameDir, write, make, read: relativePath => fs.readFileSync(path.join(gameDir, relativePath), 'utf8') }
}

function stage(assets, content) {
    for(const asset of assets) {
        fs.mkdirSync(path.dirname(asset.path), { recursive: true })
        fs.writeFileSync(asset.path, content)
    }
}

test('settings policy protects player choices while allowing mandatory pack fixes', () => {
    for(const file of ['options.txt', 'optionsof.txt', 'servers.dat', 'config/sodium-options.json', 'config/xaero/minimap/client.cfg', 'config/controlify.json', 'config/create-client.toml']) {
        assert.equal(isUserSettingsPath(file), true, file)
    }
    for(const file of ['config/fancymenu/customization/all_of_create.txt', 'config/drippyloadingscreen/options.txt', 'config/paxi/datapacks/fix/pack.mcmeta', 'config/bcc-common.toml', 'config/ftbquests/quests/data.snbt', 'mods/mod.jar', 'shaderpacks/shader.zip', 'config/../mods/mod.jar']) {
        assert.equal(isUserSettingsPath(file), false, file)
    }
})

test('first upgrade preserves existing settings and saves their original bytes', async t => {
    const f = fixture(t)
    f.write('config/client.json', '{"scale":3}')
    f.write('options.txt', 'key_key.jump:key.keyboard.space')
    const { preserver, invalid } = f.make({ 'config/client.json': '{"scale":1}' }, '1.0.10')
    assert.equal(preserver.filterAssets(await invalid()).length, 0)
    assert.equal(fs.readFileSync(path.join(preserver.backupDirectory, 'config/client.json'), 'utf8'), '{"scale":3}')
    assert.equal(fs.readFileSync(path.join(preserver.backupDirectory, 'options.txt'), 'utf8'), 'key_key.jump:key.keyboard.space')
    preserver.commit()
    assert.equal(f.read('config/client.json'), '{"scale":3}')
})

test('fresh install receives verified defaults without writing settings during download', async t => {
    const f = fixture(t)
    const { preserver, invalid } = f.make({ 'config/client.json': 'defaults' })
    const assets = preserver.filterAssets(await invalid())
    assert.equal(assets.length, 1)
    assert.notEqual(assets[0].path, path.join(f.gameDir, 'config/client.json'))
    stage(assets, 'defaults')
    assert.equal(fs.existsSync(path.join(f.gameDir, 'config/client.json')), false)
    preserver.commit()
    assert.equal(f.read('config/client.json'), 'defaults')
    assert.equal(JSON.parse(f.read('.krwa-user-settings.json')).files['config/client.json'], hash('defaults'))
})

test('unchanged defaults update but customized settings survive a new modpack version', async t => {
    const f = fixture(t)
    const defaults = { 'config/a.json': 'old', 'config/b.json': 'old' }
    f.write('config/a.json', 'old')
    f.write('config/b.json', 'old')
    const initial = f.make(defaults)
    assert.equal(initial.preserver.filterAssets(await initial.invalid()).length, 0)
    initial.preserver.commit()
    f.write('config/b.json', 'player')
    const update = f.make({ 'config/a.json': 'new', 'config/b.json': 'new' }, '2')
    const assets = update.preserver.filterAssets(await update.invalid())
    assert.deepEqual(assets.map(asset => asset.id), ['settings:config/a.json'])
    stage(assets, 'new')
    update.preserver.commit()
    assert.equal(f.read('config/a.json'), 'new')
    assert.equal(f.read('config/b.json'), 'player')
    assert.equal(fs.readFileSync(path.join(update.preserver.backupDirectory, 'config/b.json'), 'utf8'), 'player')
    const repeat = f.make({ 'config/a.json': 'new', 'config/b.json': 'new' }, '2')
    assert.equal(repeat.preserver.filterAssets(await repeat.invalid()).length, 0)
    assert.equal(repeat.preserver.backupDirectory, undefined)
    repeat.preserver.commit()
    assert.equal(f.read('config/b.json'), 'player')
})

test('failed integrity validation leaves previous settings and history untouched', async t => {
    const f = fixture(t)
    f.write('config/client.json', 'old')
    const initial = f.make({ 'config/client.json': 'old' })
    initial.preserver.commit()
    const state = f.read('.krwa-user-settings.json')
    const update = f.make({ 'config/client.json': 'new' }, '2')
    stage(update.preserver.filterAssets(await update.invalid()), 'partial')
    assert.throws(() => update.preserver.commit(), /integrity/)
    assert.equal(f.read('config/client.json'), 'old')
    assert.equal(f.read('.krwa-user-settings.json'), state)
})

test('an edit made during download is preserved instead of replaced by the new default', async t => {
    const f = fixture(t)
    f.write('config/client.json', 'old')
    const initial = f.make({ 'config/client.json': 'old' })
    initial.preserver.commit()
    const update = f.make({ 'config/client.json': 'new' }, '2')
    stage(update.preserver.filterAssets(await update.invalid()), 'new')
    f.write('config/client.json', 'player edited while downloading')
    update.preserver.commit()
    assert.equal(f.read('config/client.json'), 'player edited while downloading')
})

test('corrupt history preserves existing custom settings conservatively', async t => {
    const f = fixture(t)
    f.write('.krwa-user-settings.json', 'broken')
    f.write('config/client.json', 'player')
    const { preserver, invalid } = f.make({ 'config/client.json': 'new' })
    assert.equal(preserver.filterAssets(await invalid()).length, 0)
    preserver.commit()
    assert.equal(f.read('config/client.json'), 'player')
})

test('pack-owned menu repair remains downloadable while settings are protected', async t => {
    const f = fixture(t)
    f.write('config/fancymenu/customization/menu.txt', 'old menu')
    f.write('config/client.json', 'player')
    const { preserver, invalid } = f.make({ 'config/fancymenu/customization/menu.txt': 'fixed menu', 'config/client.json': 'default' })
    const assets = preserver.filterAssets(await invalid())
    assert.equal(assets.length, 1)
    assert.equal(assets[0].path, path.join(f.gameDir, 'config/fancymenu/customization/menu.txt'))
    stage(assets, 'fixed menu')
    preserver.commit()
    assert.equal(f.read('config/fancymenu/customization/menu.txt'), 'fixed menu')
    assert.equal(f.read('config/client.json'), 'player')
})

test('linked configuration directories are never downloaded into or backed up', async t => {
    const f = fixture(t)
    const target = path.join(f.root, 'external')
    fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(f.gameDir, 'config'), process.platform === 'win32' ? 'junction' : 'dir')
    const { preserver, invalid } = f.make({ 'config/client.json': 'default' })
    assert.equal(preserver.filterAssets(await invalid()).length, 0)
    preserver.commit()
    assert.deepEqual(fs.readdirSync(target), [])
})

test('Nebula untracked settings without an MD5 install once and are backed up on upgrade', async t => {
    const f = fixture(t)
    const initial = f.make({ 'config/sodium-options.json': 'default' }, '1', ['config/sodium-options.json'])
    stage(initial.preserver.filterAssets(await initial.invalid()), 'default')
    initial.preserver.commit()
    f.write('config/sodium-options.json', 'player')
    const update = f.make({ 'config/sodium-options.json': 'new' }, '2', ['config/sodium-options.json'])
    assert.equal(update.preserver.filterAssets(await update.invalid()).length, 0)
    update.preserver.commit()
    assert.equal(f.read('config/sodium-options.json'), 'player')
    assert.equal(fs.readFileSync(path.join(update.preserver.backupDirectory, 'config/sodium-options.json'), 'utf8'), 'player')
})
