const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { download } = require('../app/assets/js/wholeworld')
const { clipRegion } = require('../app/assets/js/offlineworld')

test('a complete final chunk can end before sector padding, a truncated payload cannot', async t => {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'krwa-region-'))
    t.after(() => fs.rm(stage, { recursive: true, force: true }))
    const name = 'region/r.0.0.mca'
    const bytes = Buffer.alloc(8192 + 8)
    bytes.writeUInt32BE(0x201, 0)
    bytes.writeUInt32BE(4, 8192)
    bytes.set([3, 1, 2, 3], 8196)
    const hash = data => crypto.createHash('sha256').update(data).digest('hex')
    const level = Buffer.from('level')
    await fs.mkdir(path.join(stage, 'region'))
    await fs.writeFile(path.join(stage, 'level.dat'), level)
    async function index(region) {
        await fs.writeFile(path.join(stage, name), region)
        const files = [
            { path: 'level.dat', bytes: level.length, sha256: hash(level) },
            { path: name, bytes: region.length, sha256: hash(region) }
        ]
        return download({ uid: 'a'.repeat(32) }, '', {}, { files, bytes: level.length + region.length }, stage)
    }
    assert.equal((await index(bytes))[name][0], hash(bytes.subarray(8192)))
    assert.equal((await clipRegion(stage, name, [0])).length, 12288)
    await assert.rejects(index(bytes.subarray(0, -1)), /Неполные данные чанка/)
    await assert.rejects(clipRegion(stage, name, [0]), /Неполный чанк/)
})
