const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
    desktopEntry,
    desktopExecArgument,
    installLinuxIntegration
} = require('../app/assets/js/linuxintegration')

test('Linux integration installs an AppImage and desktop entry in the user home', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-linux-integration-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const source = path.join(root, 'downloaded launcher.AppImage')
    const icon = path.join(root, 'icon.png')
    fs.writeFileSync(source, 'appimage')
    fs.writeFileSync(icon, 'png')
    let steamDesktopFile

    const result = await installLinuxIntegration({
        homeDirectory: path.join(root, 'home'),
        appImageSource: source,
        iconSource: icon,
        environmentPath: '',
        addToSteam: async file => {
            steamDesktopFile = file
            return true
        }
    })

    assert.equal(fs.readFileSync(result.executablePath, 'utf8'), 'appimage')
    assert.equal(result.installedAppImageCopy, true)
    assert.equal(result.steamAdded, true)
    assert.equal(steamDesktopFile, result.desktopFile)
    const contents = fs.readFileSync(result.desktopFile, 'utf8')
    assert.match(contents, /^\[Desktop Entry\]$/m)
    assert.ok(contents.includes(`Exec=env APPIMAGE_EXTRACT_AND_RUN=1 ${desktopExecArgument(result.executablePath)}`))
    assert.ok(contents.includes('StartupWMClass=ru.krwa.launcher'))
})

test('Steam Deck first run creates shortcuts and artwork and repeat runs preserve existing artwork', async t => {
    const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-deck-integration-'))
    t.after(() => fs.rmSync(homeDirectory, { recursive: true, force: true }))
    const appImageSource = path.join(homeDirectory, 'KRWA-Launcher-0.1.28.AppImage')
    const iconSource = path.join(homeDirectory, 'icon.png')
    const config = path.join(homeDirectory, '.local', 'share', 'Steam', 'userdata', '42', 'config')
    const grid = path.join(config, 'grid')
    const artworkDirectory = path.join(homeDirectory, 'artwork')
    fs.writeFileSync(appImageSource, 'appimage')
    fs.writeFileSync(iconSource, 'icon')
    fs.mkdirSync(config, { recursive: true })
    fs.mkdirSync(artworkDirectory)
    for (const name of ['portrait.jpg', 'landscape.jpg', 'hero.jpg', 'logo.png']) {
        fs.writeFileSync(path.join(artworkDirectory, name), name)
    }
    const appId = Buffer.alloc(4)
    appId.writeUInt32LE(2396744523)
    let adds = 0
    const options = {
        homeDirectory, appImageSource, iconSource, artworkDirectory, steamDeck: true, automatic: true, version: '0.1.28',
        addToSteam: async desktopFile => {
            adds++
            const installed = path.join(homeDirectory, '.local', 'opt', 'krwa-launcher', 'KRWA-Launcher.AppImage')
            assert.ok(fs.existsSync(desktopFile))
            fs.writeFileSync(path.join(config, 'shortcuts.vdf'), Buffer.concat([
                Buffer.from('\x00shortcuts\x00\x000\x00\x02appid\x00', 'binary'),
                appId,
                Buffer.from(`\x01appname\x00KRWA Launcher\x00\x01Exe\x00"${installed}"\x00\x00tags\x00\x08\x08\x08\x08`, 'binary')
            ]))
            return true
        }
    }
    assert.equal((await installLinuxIntegration(options)).steamAdded, true)
    assert.ok(fs.existsSync(path.join(homeDirectory, 'Desktop', 'KRWA Launcher.desktop')))
    assert.deepEqual(fs.readdirSync(grid).sort(), ['2396744523.jpg', '2396744523_hero.jpg', '2396744523_logo.png', '2396744523p.jpg'])
    const cover = path.join(grid, '2396744523p.jpg')
    fs.writeFileSync(cover, 'user cover')
    assert.equal((await installLinuxIntegration(options)).installedAppImageCopy, false)
    assert.equal(adds, 1)
    assert.equal(fs.readFileSync(cover, 'utf8'), 'user cover')
})

test('Linux integration keeps a package-managed executable and supports manual Steam setup', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-linux-package-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const executable = path.join(root, 'opt', 'KRWA Launcher', 'krwa-launcher')
    const icon = path.join(root, 'icon.png')
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    fs.writeFileSync(executable, 'binary')
    fs.writeFileSync(icon, 'png')

    const result = await installLinuxIntegration({
        homeDirectory: path.join(root, 'home'),
        appImageSource: '',
        packagedExecutable: executable,
        iconSource: icon,
        environmentPath: '',
        addToSteam: async () => false
    })

    assert.equal(result.executablePath, executable)
    assert.equal(result.installedAppImageCopy, false)
    assert.equal(result.steamAdded, false)
})

test('desktop entries quote paths and escape field codes', () => {
    const entry = desktopEntry('/home/deck/My % Launcher', '/home/deck/icon.png')
    assert.ok(entry.includes('Exec="/home/deck/My %% Launcher"'))
    assert.throws(() => desktopExecArgument('/tmp/bad\npath'), /Invalid/)
})
