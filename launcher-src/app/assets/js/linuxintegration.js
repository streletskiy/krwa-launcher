const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DESKTOP_ID = 'ru.krwa.launcher'

function desktopExecArgument(value) {
    if(typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
        throw new Error('Invalid desktop entry path')
    }
    return `"${value
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('`', '\\`')
        .replaceAll('$', '\\$')
        .replaceAll('%', '%%')}"`
}

function desktopEntry(executablePath, iconPath) {
    return [
        '[Desktop Entry]',
        'Name=KRWA Launcher',
        'Name[ru]=KRWA Launcher',
        'Name[pl]=KRWA Launcher',
        'Comment=KRWA Minecraft Launcher',
        'Comment[ru]=Лаунчер Minecraft-сервера KRWA',
        'Comment[pl]=Launcher serwera Minecraft KRWA',
        `Exec=${desktopExecArgument(executablePath)}`,
        `Icon=${iconPath}`,
        'Terminal=false',
        'Type=Application',
        'Categories=Game;',
        'StartupWMClass=ru.krwa.launcher',
        ''
    ].join('\n')
}

function atomicCopy(source, destination, mode) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    try {
        fs.copyFileSync(source, temporary)
        if(mode !== undefined) fs.chmodSync(temporary, mode)
        fs.renameSync(temporary, destination)
    } finally {
        try { fs.rmSync(temporary, { force: true }) } catch { /* Best-effort cleanup. */ }
    }
}

function atomicWrite(destination, content, mode) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode })
        fs.renameSync(temporary, destination)
    } finally {
        try { fs.rmSync(temporary, { force: true }) } catch { /* Best-effort cleanup. */ }
    }
}

function isExecutable(file) {
    try {
        fs.accessSync(file, fs.constants.X_OK)
        return true
    } catch {
        return false
    }
}

function findExecutable(name, environmentPath = process.env.PATH || '') {
    const candidates = environmentPath.split(path.delimiter)
        .filter(Boolean)
        .map(directory => path.join(directory, name))
    candidates.push(path.join('/usr/bin', name))
    return candidates.find(isExecutable)
}

function run(executable, args, timeout = 15000) {
    return new Promise(resolve => {
        let settled = false
        const child = childProcess.spawn(executable, args, {
            stdio: 'ignore',
            detached: false
        })
        const finish = code => {
            if(settled) return
            settled = true
            clearTimeout(timer)
            resolve(code === 0)
        }
        const timer = setTimeout(() => {
            child.kill()
            finish(null)
        }, timeout)
        child.once('error', () => finish(null))
        child.once('close', finish)
    })
}

async function addDesktopEntryToSteam(desktopFile, options = {}) {
    const helper = options.steamHelper || findExecutable('steamos-add-to-steam', options.environmentPath)
    if(!helper) return false
    const runner = options.runCommand || run
    return runner(helper, [desktopFile])
}

async function installLinuxIntegration(options = {}) {
    const homeDirectory = path.resolve(options.homeDirectory || os.homedir())
    const appImageSource = options.appImageSource || process.env.APPIMAGE
    const packagedExecutable = options.packagedExecutable || process.execPath
    const iconSource = options.iconSource

    if(!iconSource || !fs.statSync(iconSource).isFile()) throw new Error('Launcher icon is unavailable')

    const installDirectory = path.join(homeDirectory, '.local', 'opt', 'krwa-launcher')
    const installedAppImage = path.join(installDirectory, 'KRWA-Launcher.AppImage')
    let executablePath = packagedExecutable
    let installedAppImageCopy = false

    if(appImageSource) {
        if(!fs.statSync(appImageSource).isFile()) throw new Error('AppImage is unavailable')
        executablePath = installedAppImage
        if(path.resolve(appImageSource) !== path.resolve(installedAppImage)) {
            atomicCopy(appImageSource, installedAppImage, 0o755)
            installedAppImageCopy = true
        } else {
            fs.chmodSync(installedAppImage, 0o755)
        }
    } else if(!packagedExecutable || !fs.statSync(packagedExecutable).isFile()) {
        throw new Error('Packaged launcher executable is unavailable')
    }

    const iconPath = path.join(homeDirectory, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', `${DESKTOP_ID}.png`)
    const desktopFile = path.join(homeDirectory, '.local', 'share', 'applications', `${DESKTOP_ID}.desktop`)
    atomicCopy(iconSource, iconPath, 0o644)
    atomicWrite(desktopFile, desktopEntry(executablePath, iconPath), 0o644)

    const desktopDatabase = findExecutable('update-desktop-database', options.environmentPath)
    if(desktopDatabase) {
        const runner = options.runCommand || run
        await runner(desktopDatabase, [path.dirname(desktopFile)])
    }

    const steamAdded = options.addToSteam
        ? await options.addToSteam(desktopFile)
        : await addDesktopEntryToSteam(desktopFile, options)

    return {
        desktopFile,
        executablePath,
        installedAppImageCopy,
        steamAdded
    }
}

module.exports = {
    DESKTOP_ID,
    addDesktopEntryToSteam,
    desktopEntry,
    desktopExecArgument,
    installLinuxIntegration
}
