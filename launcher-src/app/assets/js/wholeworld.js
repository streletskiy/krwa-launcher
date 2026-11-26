'use strict'
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const path = require('node:path')
const got = require('got')
const { withSaveLock } = require('./triplock')

const partSize = 4 * 1024 * 1024
const maximumRegion = 256 * 1024 * 1024
const region = /^region\/r\.-?\d{1,7}\.-?\d{1,7}\.mca$/
const entry = /^(?:region|poi|entities)\/(?:r\.-?\d{1,7}\.-?\d{1,7}\.mca|c\.-?\d{1,8}\.-?\d{1,8}\.mcc)$/
const ancillary = /^(?:sublevels\/r\.-?\d+\.-?\d+\.slvlr|data\/(?:map_\d+|idcounts|raids(?:_end)?|random_sequences|aeronautics_unloaded_balloons|create_aeronautics_automated_logistics_(?:runtime|ship_body_directory)|sable_sub_level_force_load_tickets)\.dat|mfix_stronghold_cache_v2\.nbt)$/
const serverConfig = /^serverconfig\/openpartiesandclaims-(?:default-player|expired-claim|server-claim|wilderness)-config\.toml$/
const vehicleFile = /^(?:entities\/r\.-?\d{1,7}\.-?\d{1,7}\.mca|sublevels\/r\.-?\d{1,7}\.-?\d{1,7}(?:\.slvlr|\.\d{1,5}\.slvls|(?:\.r|\.\d{1,5}\.s)\/\d{1,4}\.slvl)|data\/sable_sub_level_(?:occupancy|force_load_tickets)\.dat)$/
const vanilla = { 'minecraft:overworld': '', 'minecraft:the_nether': 'DIM-1/', 'minecraft:the_end': 'DIM1/' }
function prefixes(dimensions = Object.keys(vanilla)) {
    return dimensions.map(key => {
        if (Object.hasOwn(vanilla, key)) return vanilla[key]
        const [namespace, location, extra] = typeof key === 'string' ? key.split(':') : []
        if (!namespace || !location || extra !== undefined || !/^[a-z0-9_-][a-z0-9_.-]*$/.test(namespace) ||
            namespace.endsWith('.') || location.split('/').some(s => !/^[a-z0-9_.-]+$/.test(s) || s.endsWith('.')))
            throw Error('Некорректное измерение.')
        return 'dimensions/' + key.replace(':', '/') + '/'
    })
}
function playerProgress(uid) {
    const id = uid.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
    return ['advancements/' + id + '.json', 'ftbquests/' + id + '.snbt']
}
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex')

async function regular(root, name, maximum) {
    const file = path.join(root, name)
    if ((await fs.realpath(file)) !== path.join(await fs.realpath(root), name))
        throw Error('Ссылка в файлах мира.')
    const st = await fs.lstat(file)
    if (!st.isFile() || st.size > maximum)
        throw Error('Не удалось прочитать файл мира.')
    return file
}

function records(bytes) {
    // Minecraft creates zero-length region files before their first chunk save.
    if (bytes.length === 0) return new Map()
    if (bytes.length < 8192 || bytes.length % 4096)
        throw Error('Повреждён регион.')
    const slots = new Map()
    for (let slot = 0; slot < 1024; slot++) {
        const pos = bytes.readUIntBE(4 * slot, 3) * 4096,
            sectors = bytes[4 * slot + 3]
        if (!pos && !sectors) continue
        if (pos < 8192 || !sectors || pos + sectors * 4096 > bytes.length)
            throw Error('Некорректный заголовок региона.')
        const length = bytes.readUInt32BE(pos)
        if (!length || length + 4 > sectors * 4096)
            throw Error('Неполный чанк.')
        slots.set(slot, bytes.subarray(pos, pos + 4 + length))
    }
    return slots
}

function delta(bytes, original) {
    const header = Buffer.alloc(8192),
        output = [header]
    let sectors = 2
    for (const [slot, data] of records(bytes)) {
        if (original?.[slot] === hash(data)) continue
        if (data[4] & 128)
            throw Error(
                'Изменён внешний чанк .mcc. Сохраните локальную поездку для ручного переноса.',
            )
        const count = Math.ceil(data.length / 4096)
        const packed = Buffer.alloc(count * 4096)
        data.copy(packed)
        header.writeUIntBE(sectors, slot * 4, 3)
        header[slot * 4 + 3] = count
        sectors += count
        output.push(packed)
    }
    return output.length === 1 ? null : Buffer.concat(output)
}

async function download(client, api, trip, area, stage, progress) {
    const dirs = prefixes(area.dimensions)
    const personal = playerProgress(client.uid)
    const matches = (file, pattern) => dirs.some(prefix => file.startsWith(prefix) && pattern.test(file.slice(prefix.length)))
    const files = area.files
    if (!Array.isArray(files) || !files.length || files.length > 100000)
        throw Error('Некорректное описание мира.')
    const names = new Set()
    let total = 0
    for (const file of files) {
        if (
            (typeof file.path !== 'string' || (file.path !== 'level.dat' && !personal.includes(file.path) && !matches(file.path, entry) && !matches(file.path, ancillary) && !matches(file.path, vehicleFile) && !serverConfig.test(file.path))) ||
            names.has(file.path) ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            !/^[0-9a-f]{64}$/.test(file.sha256)
        )
            throw Error('Некорректный файл снимка.')
        total += file.bytes
        names.add(file.path)
    }
    if (!names.has('level.dat') || total !== area.bytes)
        throw Error('Неполный снимок.')
    const index = { dimensions: area.dimensions, vehicles: {} }
    let received = 0
    for (const [i, file] of files.entries()) {
        const target = path.join(stage, file.path)
        await fs.mkdir(path.dirname(target), { recursive: true })
        if (
            (await fs.realpath(path.dirname(target))) !==
            path.dirname(path.join(await fs.realpath(stage), file.path))
        )
            throw Error('Ссылка в папке загрузки.')
        let valid = false
        try {
            const src = await regular(stage, file.path, file.bytes)
            const h = crypto.createHash('sha256')
            for await (const b of require('node:fs').createReadStream(src))
                h.update(b)
            valid = h.digest('hex') === file.sha256
        } catch (e) {
            if (e.code !== 'ENOENT') throw e
        }
        if (!valid) {
            const free = await fs.statfs(stage)
            if (free.bavail * free.bsize < file.bytes + 256 * 1024 ** 2)
                throw Error('Для полного мира недостаточно места.')
            const temp = target + '.part'
            await fs.rm(temp, { force: true })
            const f = await fs.open(temp, 'wx', 0o600)
            try {
                const h = crypto.createHash('sha256')
                let n = 0
                const stream = got.stream(
                    api + '/trips/' + trip.id + '/files/' + i,
                    {
                        headers: client.headers,
                        followRedirect: false,
                        timeout: { socket: 90000 },
                        retry: 0,
                    },
                )
                try {
                    for await (const b of stream) {
                        n += b.length
                        if (n > file.bytes)
                            throw Error('Размер файла изменился.')
                        h.update(b)
                        await f.writeFile(b)
                        progress?.(received + n, total)
                    }
                } finally {
                    stream.destroy()
                }
                if (n !== file.bytes || h.digest('hex') !== file.sha256)
                    throw Error('Не совпала контрольная сумма файла.')
                await f.close()
                await fs.rename(temp, target)
            } finally {
                await f.close()
                await fs.rm(temp, { force: true })
            }
        }
        if (file.path.endsWith('.mcc') && file.path.includes('region/'))
            index[file.path] = file.sha256
        if (matches(file.path, vehicleFile)) index.vehicles[file.path] = file.sha256
        if (personal.includes(file.path)) index[file.path] = file.sha256
        if (matches(file.path, region)) {
            const bytes = await fs.readFile(
                await regular(stage, file.path, maximumRegion),
            )
            index[file.path] = Object.fromEntries(
                Array.from(records(bytes), ([slot, data]) => [
                    slot,
                    hash(data),
                ]),
            )
        }
        received += file.bytes
        progress?.(received, total)
    }
    return index
}

async function vehicleChanges(save, base, add) {
    if (!base.vehicles) return
    const missing = new Set(Object.keys(base.vehicles))
    async function scan(prefix, group) {
        const name = prefix + group
        const dir = path.join(save, name)
        let items
        try {
            if (await fs.realpath(dir) !== path.join(await fs.realpath(save), name)) throw Error('Ссылка в файлах транспорта.')
            items = await fs.readdir(dir, {withFileTypes:true})
        } catch (e) {
            if (e.code === 'ENOENT') return
            throw e
        }
        for (const item of items) {
            const rel = group + '/' + item.name
            if (group === 'sublevels' && item.isDirectory() && /^r\.-?\d+\.-?\d+(?:\.r|\.\d+\.s)$/.test(item.name)) {
                await scan(prefix, rel)
                continue
            }
            if (!vehicleFile.test(rel)) continue
            const file = prefix + rel
            missing.delete(file)
            const data = await fs.readFile(await regular(save, file, maximumRegion))
            if (!data.length) {
                if (Object.hasOwn(base.vehicles,file)) await add('removed/'+file,Buffer.from('1'))
            } else if (hash(data) !== base.vehicles[file]) await add(file,data)
        }
    }
    for (const prefix of prefixes(base.dimensions))
        for (const group of ['entities','sublevels','data']) await scan(prefix,group)
    for (const file of missing) await add('removed/' + file,Buffer.from('1'))
}

async function prepareTransfer(client, save, id, target, progress) {
    const base = JSON.parse(
        await fs.readFile(path.join(client.home, id + '.chunks.json'), 'utf8'),
    )
    const stage = await fs.mkdtemp(path.join(client.home, '.transfer-'))
    const files = []
    let total = 0
    async function add(name, bytes) {
        total += bytes.length
        if (total > 2 * 1024 ** 3)
            throw Error(
                'За одну поездку можно отправить до 2 ГиБ изменённых чанков.',
            )
        const parts = []
        for (let i = 0; i < bytes.length; i += partSize) {
            const part = bytes.subarray(i, i + partSize),
                sum = hash(part)
            await fs.writeFile(path.join(stage, sum), part, { mode: 0o600 })
            parts.push(sum)
        }
        files.push({ path: name, bytes: bytes.length, parts })
    }
    try {
        await withSaveLock(client.java, save, async () => {
            await add(
                'level.dat',
                await fs.readFile(await regular(save, 'level.dat', partSize)),
            )
            await vehicleChanges(save, base, add)
            const names = []
            for (const name of playerProgress(client.uid)) {
                if (!base[name]) continue
                const data = await fs.readFile(await regular(save, name, 16 * 1024 ** 2))
                if (hash(data) !== base[name]) await add(name, data)
            }
            for (const prefix of prefixes(base.dimensions)) {
                const dir = path.join(save, prefix, 'region')
                let list
                try {
                    list = await fs.readdir(dir)
                } catch (e) {
                    if (e.code === 'ENOENT') continue
                    throw e
                }
                for (const name of list) {
                    const rel = prefix + 'region/' + name
                    if (region.test('region/' + name)) names.push(rel)
                    if (
                        entry.test('region/' + name) &&
                        name.endsWith('.mcc') &&
                        base[rel] !==
                            hash(
                                await fs.readFile(
                                    await regular(save, rel, maximumRegion),
                                ),
                            )
                    )
                        throw Error(
                            'Для изменённого внешнего чанка .mcc нужен ручной перенос.',
                        )
                }
            }
            for (const [i, name] of names.sort().entries()) {
                const bytes = await fs.readFile(
                    await regular(save, name, maximumRegion),
                )
                const changed = delta(bytes, base[name])
                if (changed) await add(name, changed)
                progress?.(
                    'Сравнение регионов · ' + (i + 1) + ' / ' + names.length,
                )
            }
        })
        await fs.writeFile(
            path.join(stage, 'manifest.json'),
            JSON.stringify(files),
            { flag: 'wx' },
        )
        await fs.rename(stage, target)
    } finally {
        await fs.rm(stage, { recursive: true, force: true })
    }
}

async function send(client, info, save, atomicJson, progress) {
    const target = path.join(client.home, info.id + '.out')
    if (info.stage === 'ready') {
        // A returned trip gets a fresh immutable upload. A pending transfer is retried byte for byte.
        const old = target + '.old-' + crypto.randomUUID()
        try {
            await fs.rename(target, old)
            await fs.rm(old, { recursive: true, force: true })
        } catch (e) {
            if (e.code !== 'ENOENT') throw e
        }
        await prepareTransfer(client, save, info.id, target, progress)
        info.stage = 'sending'
        await atomicJson(client.stateFile, info)
    }
    const files = JSON.parse(
        await fs.readFile(path.join(target, 'manifest.json'), 'utf8'),
    )
    const route = '/trips/' + info.id + '/transfer'
    const batch = await client.api(route, 'POST', { files })
    if (!batch.complete) {
        const all = files.flatMap((f) => f.parts)
        if (!/^[a-f0-9]{64}$/.test(batch.key) || !Array.isArray(batch.missing))
            throw Error('Некорректный ответ при отправке.')
        for (const [i, n] of batch.missing.entries()) {
            if (
                !Number.isInteger(n) ||
                n < 0 ||
                n >= all.length ||
                !/^[0-9a-f]{64}$/.test(all[n])
            )
                throw Error('Некорректная часть отправки.')
            await client.call(route + '/' + batch.key + '/' + n, {
                method: 'PUT',
                headers: client.headers,
                body: await fs.readFile(
                    await regular(target, all[n], partSize),
                ),
            })
            progress?.(
                'Передача изменений · ' +
                    (i + 1) +
                    ' / ' +
                    batch.missing.length,
            )
        }
        await client.api(route + '/' + batch.key + '/finish', 'POST', {})
    }
    info.stage = 'sent'
    await atomicJson(client.stateFile, info)
}
module.exports = { download, send }
