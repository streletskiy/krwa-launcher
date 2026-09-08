const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const profile = path.resolve(__dirname, '..', '..', 'repository', 'servers', 'krwa-aeronautics-1.21.1')
const layoutPath = path.join(profile, 'files', 'config', 'fancymenu', 'customization', 'all_of_create.txt')
const backgroundPath = path.join(profile, 'files', 'config', 'fancymenu', 'assets', 'bg-krwa.png')
const fancyMenuAssets = path.join(profile, 'files', 'config', 'fancymenu', 'assets')

test('KRWA profile excludes the public server browser and hosting promotions', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(profile, 'neoforge-lock.json'), 'utf8'))
    assert.equal(lock.modules.some(module => /serverbrowser/i.test(`${module.id} ${module.name}`)), false)
    assert.equal(fs.existsSync(path.join(profile, 'files', 'config', 'serverbrowser.conf')), false)

    const sourceManifest = JSON.parse(fs.readFileSync(path.join(profile, 'source', 'curseforge-manifest.json'), 'utf8'))
    assert.equal(sourceManifest.files.some(file => file.projectID === 825617), false)

    const distribution = fs.readFileSync(path.resolve(profile, '..', '..', 'distribution.json'), 'utf8')
    assert.doesNotMatch(distribution, /serverbrowser/i)

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
})
