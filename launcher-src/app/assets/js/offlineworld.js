'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const got = require('got')
const { withSaveLock } = require('./triplock')
const wholeWorld = require('./wholeworld')
const AdmZip = require('adm-zip')

const PROFILE = 'krwa-aeronautics-1.21.1'
const API = 'https://mc.krwa.ru/api/offline-worlds'
const LIMIT = 48 * 1024 * 1024
const idPattern = /^[a-f0-9]{32}$/
const regional = /^(region|poi)\/r\.-?\d+\.-?\d+\.mca$/

function uuid(value) {
    const id = String(value).replace(/-/g, '').toLowerCase()
    if (!idPattern.test(id)) throw Error('Некорректный профиль KRWA.')
    return id
}

function folderName(id) {
    return 'KRWA-Offline-' + uuid(id)
}

async function atomicJson(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = file + '.' + crypto.randomUUID() + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
    await fs.rename(tmp, file)
}

async function safeFile(root, rel, max) {
    const file = path.join(root, rel)
    const realRoot = await fs.realpath(root)
    if ((await fs.realpath(file)) !== path.join(realRoot, rel))
        throw Error('Ссылка внутри сохранения.')
    const info = await fs.lstat(file)
    if (!info.isFile() || info.size > max)
        throw Error('Некорректный размер файла мира.')
    return file
}

function regions(area, group = 'region') {
    const result = new Map()
    for (const [x, z] of area.chunks) {
        const name =
            group +
            '/r.' +
            Math.floor(x / 32) +
            '.' +
            Math.floor(z / 32) +
            '.mca'
        if (!result.has(name)) result.set(name, [])
        result.get(name).push((x & 31) + 32 * (z & 31))
    }
    return result
}

async function clipRegion(root, name, slots) {
    const handle = await fs.open(
        await safeFile(root, name, 256 * 1024 * 1024),
        'r',
    )
    try {
        const header = Buffer.alloc(8192)
        if ((await handle.read(header, 0, 8192, 0)).bytesRead !== 8192)
            throw Error('Неполный регион.')
        const next = Buffer.alloc(8192)
        const parts = [next]
        let end = 2
        for (const slot of slots) {
            const start = header.readUIntBE(slot * 4, 3),
                count = header[slot * 4 + 3]
            if (!start && !count) continue
            if (start < 2 || !count) throw Error('Повреждён заголовок региона.')
            const data = Buffer.alloc(count * 4096)
            if (
                (await handle.read(data, 0, data.length, start * 4096))
                    .bytesRead !== data.length
            )
                throw Error('Неполный чанк.')
            next.writeUIntBE(end, slot * 4, 3)
            next[slot * 4 + 3] = count
            header.copy(next, 4096 + slot * 4, 4096 + slot * 4, 4100 + slot * 4)
            end += count
            parts.push(data)
        }
        return Buffer.concat(parts)
    } finally {
        await handle.close()
    }
}

class OfflineWorld {
    constructor(config, account) {
        this.account = account
        this.java = config.getJavaExecutable(PROFILE)
        this.uid = uuid(account.uuid)
        this.home = path.join(
            config.getLauncherDirectory(),
            'offline-worlds',
            this.uid,
        )
        this.saves = path.join(config.getInstanceDirectory(), PROFILE, 'saves')
        this.stateFile = path.join(this.home, 'current.json')
    }
    async local() {
        try {
            const info = JSON.parse(await fs.readFile(this.stateFile, 'utf8'))
            await fs.access(path.join(this.saves, folderName(info.id), 'level.dat'))
            return info
        } catch (e) {
            if (e.code === 'ENOENT') return null
            throw e
        }
    }
    async submittedIds() {
        const entries = await fs.readdir(this.home).catch(e => {
            if (e.code === 'ENOENT') return []
            throw e
        })
        return [...new Set(entries.flatMap(name => {
            const match = /^([a-f0-9]{32})\.(out|zip)$/.exec(name)
            return match ? [match[1]] : []
        }))]
    }
    async reconcileApplied(latest, ids) {
        for (const id of ids || await this.submittedIds()) {
            try {
                const receipt = latest?.id === id ? latest : await this.api('/trips/' + id + '/receipt')
                if (receipt?.state === 'done' && receipt.id === id && uuid(receipt.uid) === this.uid)
                    await this.retireApplied(id)
            } catch {
                // A missing receipt, a running game or a disconnected disk can be retried on the next refresh.
            }
        }
    }
    async retireApplied(id) {
        const save = path.join(this.saves, folderName(id))
        const retired = path.join(path.dirname(this.saves), '.krwa-applied-' + id)
        const out = path.join(this.home, id + '.out')
        const zip = path.join(this.home, id + '.zip')
        const stat = async file => fs.lstat(file).catch(e => {
            if (e.code === 'ENOENT') return null
            throw e
        })
        const ownedDirectory = async dir => {
            const info = await stat(dir)
            if (!info) return false
            if (!info.isDirectory()) throw Error('Некорректная папка поездки.')
            const marker = await safeFile(dir, 'krwa-trip.json', 16 * 1024 * 1024)
            if (JSON.parse(await fs.readFile(marker, 'utf8')).id !== id) throw Error('Сохранение другой поездки.')
            return true
        }
        const packet = await stat(out)
        const archive = await stat(zip)
        if (!(packet || archive) || (packet && !packet.isDirectory()) || (archive && !archive.isFile())) return
        if (await ownedDirectory(save)) {
            const target = await withSaveLock(this.java, save, async () => {
                if (await ownedDirectory(retired)) throw Error('Идёт очистка поездки.')
                const level = await fs.readFile(await safeFile(save, 'level.dat', 4 * 1024 * 1024))
                const hash = data => crypto.createHash('sha256').update(data).digest('hex')
                let sentHash, sentTime
                if (packet) {
                    const manifest = await safeFile(out, 'manifest.json', 32 * 1024 * 1024)
                    const files = JSON.parse(await fs.readFile(manifest, 'utf8'))
                    const world = files.find(item => item.path === 'level.dat')
                    sentHash = world?.parts?.length === 1 ? world.parts[0] : null
                    sentTime = (await fs.stat(manifest)).mtimeMs
                } else {
                    if (archive.size > LIMIT) throw Error('Некорректный архив поездки.')
                    const bytes = new AdmZip(await fs.readFile(zip)).readFile('level.dat')
                    sentHash = bytes && hash(bytes)
                    sentTime = archive.mtimeMs
                }
                // Files changed outside the launcher after upload belong to the player.
                async function changedAfterUpload(dir) {
                    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
                        if (item.name === 'session.lock') continue
                        const file = path.join(dir, item.name)
                        if (item.isSymbolicLink() || (await fs.lstat(file)).mtimeMs > sentTime) return true
                        if (item.isDirectory() && await changedAfterUpload(file)) return true
                    }
                    return false
                }
                const changed = sentHash !== hash(level) || await changedAfterUpload(save)
                const target = changed ? path.join(this.saves, 'KRWA-Local-' + id + '-' + crypto.randomUUID()) : retired
                // Windows refuses to move a directory containing an open session.lock.
                // The same OS rule protects the final rename if Minecraft reopens the world.
                if (process.platform !== 'win32') await fs.rename(save, target)
                return target
            })
            if (process.platform === 'win32') await fs.rename(save, target)
        }
        if (await ownedDirectory(retired)) await fs.rm(retired, { recursive: true })
        await fs.rm(path.join(this.home, id + '.chunks.json'), { force: true })
        if (archive) await fs.unlink(zip)
        if (packet) await fs.rm(out, { recursive: true })
    }
    async independentCopy(info) {
        const name = folderName(info.id)
        const target = 'KRWA-Local-' + uuid(info.id)
        const src = path.join(this.saves, name)
        const dest = path.join(this.saves, target)
        try {
            await fs.access(path.join(dest, 'level.dat'))
            return target
        } catch (e) {
            if (e.code !== 'ENOENT') throw e
        }
        const temp = await fs.mkdtemp(path.join(this.saves, '.local-copy-'))
        try {
            await require('./triplock').withSaveLock(this.java, src, async () => {
                await fs.cp(src, temp, { recursive: true,
                    mode: require('node:fs').constants.COPYFILE_FICLONE,
                    filter: async p => path.basename(p) !== 'session.lock' && !(await fs.lstat(p)).isSymbolicLink() })
            })
            await fs.rename(temp, dest)
        } finally {
            await fs.rm(temp, { recursive: true, force: true })
        }
        return target
    }
    async call(route, options = {}) {
        const data = await got(API + route, {
            timeout: { request: 90000 },
            retry: 0,
            followRedirect: false,
            throwHttpErrors: false,
            responseType: 'buffer',
            ...options,
        })
        if (data.statusCode < 200 || data.statusCode >= 300) {
            let msg
            try {
                msg = JSON.parse(data.body.toString()).detail
            } catch {
                /* Non-JSON proxy error. */
            }
            throw Error(
                typeof msg === 'string'
                    ? msg
                    : 'Сервис поездок недоступен (' + data.statusCode + ').',
            )
        }
        return JSON.parse(data.body.toString())
    }
    async authenticate() {
        const data = await this.call('/session', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + this.account.accessToken },
            json: { profile: this.uid },
        })
        this.headers = { authorization: 'Bearer ' + data.token }
    }
    async api(route, method = 'GET', json) {
        return this.call(route, {
            method,
            headers: this.headers,
            ...(json ? { json } : {}),
        })
    }
    async download(trip, launch, progress) {
        const name = folderName(trip.id)
        const area = await this.api('/trips/' + trip.id + '/area')
        if (area.scope === 'world') {
            await fs.mkdir(this.saves, { recursive: true })
            const stage = path.join(
                path.dirname(this.saves),
                '.krwa-trip-' + uuid(trip.id),
            )
            await fs.mkdir(stage, { recursive: true })
            if ((await fs.lstat(stage)).isSymbolicLink())
                throw Error('Ссылка в папке загрузки.')
            const index = await wholeWorld.download(
                this,
                API,
                trip,
                area,
                stage,
                progress,
            )
            await atomicJson(
                path.join(this.home, uuid(trip.id) + '.chunks.json'),
                index,
            )
            const summary = {
                scope: 'world',
                bytes: area.bytes,
                dimensions: area.dimensions,
            }
            return this.install(trip, launch, summary, stage, name)
        }
        if (
            !Array.isArray(area.chunks) ||
            area.chunks.length > 25 ||
            area.chunks.some(
                (p) =>
                    !Array.isArray(p) ||
                    p.length !== 2 ||
                    !p.every(Number.isSafeInteger),
            )
        )
            throw Error('Некорректные координаты поездки.')
        await fs.mkdir(this.saves, { recursive: true })
        const free = await fs.statfs(this.saves)
        if (free.bavail * free.bsize < 256 * 1024 * 1024)
            throw Error('Для поездки нужно 256 МБ свободного места.')
        const allowed = new Set([
            'level.dat',
            ...regions(area).keys(),
            ...regions(area, 'poi').keys(),
        ])
        const response = await got(API + '/trips/' + trip.id + '/download', {
            headers: this.headers,
            timeout: { request: 120000 },
            followRedirect: false,
            retry: 0,
            responseType: 'buffer',
        })
        if (response.body.length > LIMIT)
            throw Error('Слишком большой архив мира.')
        const entries = new AdmZip(response.body).getEntries()
        if (
            !entries.some((e) => e.entryName === 'level.dat') ||
            entries.length > allowed.size
        )
            throw Error('Неполный архив мира.')
        const stage = await fs.mkdtemp(path.join(this.saves, '.krwa-trip-'))
        let total = 0
        try {
            for (const entry of entries) {
                if (!allowed.delete(entry.entryName))
                    throw Error('Посторонний файл в снимке.')
                total += entry.header.size
                if (total > LIMIT) throw Error('Неверный размер снимка.')
                const target = path.join(stage, entry.entryName)
                await fs.mkdir(path.dirname(target), { recursive: true })
                await fs.writeFile(target, entry.getData(), { flag: 'wx' })
            }
            return await this.install(trip, launch, area, stage, name)
        } finally {
            await fs.rm(stage, { recursive: true, force: true })
        }
    }
    async install(trip, launch, area, stage, name) {
        const info = {
            id: trip.id,
            version: trip.version,
            area,
            stage: 'ready',
            playerName: this.account.displayName,
            launch,
        }
        // A crash between rename and pointer persistence can be recovered
        // from the manifest bundled in the newly installed directory.
        await atomicJson(path.join(stage, 'krwa-trip.json'), info)
        const final = path.join(this.saves, name)
        try {
            await fs.rename(stage, final)
        } catch (err) {
            if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(err.code)) throw err
            const old = JSON.parse(
                await fs.readFile(
                    await safeFile(final, 'krwa-trip.json', 16 * 1024 * 1024),
                    'utf8',
                ),
            )
            if (old.id !== trip.id) throw err
            await fs.rm(stage, { recursive: true, force: true })
        }
        await atomicJson(this.stateFile, info)
        return info
    }
    async send(info, progress) {
        const save = path.join(this.saves, folderName(info.id))
        if (info.area.scope === 'world')
            return wholeWorld.send(this, info, save, atomicJson, progress)
        const pending = path.join(this.home, info.id + '.zip')
        if (info.stage === 'ready') {
            const bytes = await withSaveLock(this.java, save, async () => {
                const zip = new AdmZip()
                zip.addFile(
                    'level.dat',
                    await fs.readFile(
                        await safeFile(save, 'level.dat', 4 * 1024 * 1024),
                    ),
                )
                for (const [name, slots] of regions(info.area)) {
                    if (!regional.test(name))
                        throw Error('Некорректное имя региона.')
                    zip.addFile(name, await clipRegion(save, name, slots))
                }
                return zip.toBuffer()
            })
            if (bytes.length > LIMIT)
                throw Error('Архив превышает размер одной поездки.')
            await fs.writeFile(pending + '.next', bytes, { mode: 0o600 })
            await fs.rename(pending + '.next', pending)
            info.stage = 'sending'
            await atomicJson(this.stateFile, info)
        }
        const body = await fs.readFile(pending)
        const checksum = crypto.createHash('sha256').update(body).digest('hex')
        const result = await this.call('/trips/' + info.id, {
            method: 'PUT',
            body,
            headers: {
                ...this.headers,
                'Content-Type': 'application/zip',
                'X-Content-SHA256': checksum,
            },
        })
        info.stage = 'sent'
        await atomicJson(this.stateFile, info)
        return result
    }
}
async function localProfiles(config) {
    const home = path.join(config.getLauncherDirectory(), 'offline-worlds')
    const game = path.join(config.getInstanceDirectory(), PROFILE)
    const cache = await fs.readFile(path.join(game, 'usercache.json'), 'utf8')
        .then(JSON.parse).catch(() => [])
    const profiles = []
    for (const dir of await fs.readdir(home, { withFileTypes: true }).catch(() => [])) {
        if (!dir.isDirectory() || !idPattern.test(dir.name)) continue
        const local = new OfflineWorld(config, { uuid: dir.name })
        const trip = await local.local().catch(() => null)
        if (!trip?.launch || !idPattern.test(trip.id)) continue
        const known = Array.isArray(cache) && cache.find(p => String(p.uuid).replace(/-/g, '') === dir.name)
        profiles.push({ uuid: dir.name, displayName: trip.playerName || known?.name || 'Player', type: 'mojang' })
    }
    return profiles
}
function prepared(config) {
    const a = config.getSelectedAccount()
    if (!a || config.getSelectedServer() !== PROFILE) return false
    try {
        const current = new OfflineWorld(config, a)
        const data = JSON.parse(
            require('node:fs').readFileSync(current.stateFile, 'utf8'),
        )
        return (
            ['ready', 'sending'].includes(data.stage) && idPattern.test(data.id) &&
            require('node:fs').existsSync(path.join(current.saves, folderName(data.id), 'level.dat'))
        )
    } catch {
        return false
    }
}
module.exports = {
    OfflineWorld,
    PROFILE,
    folderName,
    regions,
    clipRegion,
    atomicJson,
    prepared,
    localProfiles,
}
