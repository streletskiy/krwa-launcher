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
    assert.ok(contents.includes(`Exec=${desktopExecArgument(result.executablePath)}`))
    assert.ok(contents.includes('StartupWMClass=ru.krwa.launcher'))
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
