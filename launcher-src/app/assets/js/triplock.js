'use strict'
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

// Minecraft uses Java FileChannel locks. Use the same primitive on SteamOS,
// Windows and macOS, including when a second launcher process owns the game.
const source = `import java.nio.channels.*;
import java.nio.file.*;
class TripSaveLock {
    public static void main(String[] args) throws Exception {
        try (FileChannel file = FileChannel.open(Path.of(args[0]), StandardOpenOption.CREATE,
             StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS); FileLock lock = file.tryLock()) {
            if (lock == null) System.exit(2);
            System.out.println("locked");
            System.out.flush();
            while (System.in.read() != -1) {}
        }
    }
}`

async function withSaveLock(java, save, fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'krwa-trip-lock-'))
    let child, timeout
    try {
        const file = path.join(dir, 'TripSaveLock.java')
        await fs.writeFile(file, source, { flag: 'wx' })
        child = spawn(java, [file, path.join(save, 'session.lock')], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'ignore'],
        })
        await new Promise((resolve, reject) => {
            const fail = () =>
                reject(
                    Error(
                        'Не удалось заблокировать сохранение. Закройте Minecraft и повторите.',
                    ),
                )
            child.once('error', fail)
            child.once('exit', fail)
            child.stdout.once('data', (data) =>
                String(data).trim() === 'locked' ? resolve() : fail(),
            )
            timeout = setTimeout(fail, 15000)
        })
        clearTimeout(timeout)
        const result = await fn()
        if (child.exitCode !== null)
            throw Error('Блокировка сохранения была потеряна.')
        return result
    } finally {
        clearTimeout(timeout)
        if (child && child.exitCode === null && child.pid) {
            const exited = once(child, 'exit').catch(() => {})
            child.stdin.end()
            await exited
        }
        await fs.rm(dir, { recursive: true, force: true })
    }
}
module.exports = { withSaveLock }
