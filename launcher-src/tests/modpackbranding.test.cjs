const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const profile = path.resolve(__dirname, '..', '..', 'repository', 'servers', 'krwa-aeronautics-1.21.1')
const layoutPath = path.join(profile, 'files', 'config', 'fancymenu', 'customization', 'all_of_create.txt')
const backgroundPath = path.join(profile, 'files', 'config', 'fancymenu', 'assets', 'bg-krwa.png')
const fancyMenuAssets = path.join(profile, 'files', 'config', 'fancymenu', 'assets')

function flattenModules(modules) {
    return modules.flatMap(module => [module, ...flattenModules(module.subModules ?? [])])
}

test('KRWA profile excludes public server browsers and hosting promotions', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(profile, 'neoforge-lock.json'), 'utf8'))
    assert.equal(lock.modules.some(module => /serverbrowser/i.test(`${module.id} ${module.name}`)), false)
    assert.equal(lock.modules.some(module => /bh\s?menu/i.test(`${module.id} ${module.name}`)), false)
    assert.equal(fs.existsSync(path.join(profile, 'files', 'config', 'serverbrowser.conf')), false)
    assert.equal(fs.existsSync(path.join(profile, 'files', 'config', 'bhmenu-client.toml')), false)
    assert.equal(fs.existsSync(path.join(profile, 'files', 'config', 'bhmenu-client-1.toml.bak')), false)

    const sourceManifest = JSON.parse(fs.readFileSync(path.join(profile, 'source', 'curseforge-manifest.json'), 'utf8'))
    assert.equal(sourceManifest.files.some(file => file.projectID === 825617), false)
    assert.equal(sourceManifest.files.some(file => file.projectID === 1084468), false)

    const distribution = fs.readFileSync(path.resolve(profile, '..', '..', 'distribution.json'), 'utf8')
    assert.doesNotMatch(distribution, /serverbrowser|bhmenu|bisecthosting|need a server/i)

    const crashAssistantMods = fs.readFileSync(path.join(profile, 'files', 'config', 'crash_assistant', 'modlist.json'), 'utf8')
    assert.doesNotMatch(crashAssistantMods, /bhmenu/i)

    const layout = fs.readFileSync(layoutPath, 'utf8')
    assert.doesNotMatch(layout, /bisecthosting|assets\/r\.png/i)
    assert.equal(fs.existsSync(path.join(fancyMenuAssets, 'r.png')), false)
    assert.equal(fs.existsSync(path.join(fancyMenuAssets, 'rh.png')), false)
    const needServer = (layout.match(/^vanilla_button \{[\s\S]*?^\}/gm) || [])
        .find(block => block.includes('instance_identifier = 376306'))
    assert(needServer)
    assert.match(needServer, /is_hidden = true/)
})

test('KRWA main-menu background has the expected branding and dimensions', () => {
    const layout = fs.readFileSync(layoutPath, 'utf8')
    assert.match(layout, /image_path = \[source:local\]\/config\/fancymenu\/assets\/bg-krwa\.png/)

    const png = fs.readFileSync(backgroundPath)
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
    assert.equal(png.readUInt32BE(16), 1920)
    assert.equal(png.readUInt32BE(20), 1080)
    assert.equal(crypto.createHash('sha256').update(png).digest('hex'), 'ae2f4fb0afd08c4ad75c5fe441996daf0d623f0e9dc0a8d664df89aa729b7df8')
})

test('KRWA main menu opens Multiplayer once per game session', () => {
    const layout = fs.readFileSync(layoutPath, 'utf8')
    const multiplayer = (layout.match(/^vanilla_button \{[\s\S]*?^\}/gm) || [])
        .find(block => block.includes('instance_identifier = mc_titlescreen_multiplayer_button'))

    assert(multiplayer)
    assert.match(multiplayer, /automated_button_clicks = 1/)
    assert.match(multiplayer, /load_once_per_session = true/)
})

test('CurseForge artifacts use non-interactive CDN URLs', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(profile, 'neoforge-lock.json'), 'utf8'))
    const distribution = JSON.parse(fs.readFileSync(path.resolve(profile, '..', '..', 'distribution.json'), 'utf8'))
    const server = distribution.servers.find(candidate => candidate.id === 'krwa-aeronautics-1.21.1')
    const lockArtifacts = flattenModules(lock.modules).map(module => module.artifact)
    const distributionArtifacts = flattenModules(server.modules).map(module => module.artifact)
    const curseForgeArtifacts = lockArtifacts.filter(artifact => artifact.url.includes('forgecdn.net'))

    assert(curseForgeArtifacts.length > 0)
    assert.equal(lockArtifacts.some(artifact => artifact.url.includes('www.curseforge.com/api/v1/')), false)
    assert.equal(distributionArtifacts.some(artifact => artifact.url.includes('www.curseforge.com/api/v1/')), false)
    for(const artifact of curseForgeArtifacts) {
        const url = new URL(artifact.url)
        assert.equal(url.protocol, 'https:')
        assert.equal(url.hostname, 'mediafilez.forgecdn.net')
        assert.match(url.pathname, /^\/files\/\d+\/\d+\/[^/]+$/)
        assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), artifact.path.split('/').at(-1))
    }
})
