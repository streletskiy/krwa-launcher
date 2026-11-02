const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const dircompare = require('dir-compare')
const temp = require('temp')

test('patched build dependencies preserve filtered directory comparisons', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krwa-compare-'))
    try {
        for (const directory of ['left', 'right']) {
            fs.mkdirSync(path.join(root, directory))
            fs.writeFileSync(path.join(root, directory, 'included.txt'), 'same')
            fs.writeFileSync(path.join(root, directory, 'ignored.bin'), directory)
        }
        const result = await dircompare.compare(path.join(root, 'left'), path.join(root, 'right'), {
            compareContent: true, includeFilter: '*.txt'
        })
        assert.equal(result.same, true)
        assert.equal(result.equal, 1)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})

test('temporary build directories support callback and synchronous cleanup', async () => {
    temp.track()
    const first = temp.mkdirSync('krwa-temp-sync-')
    fs.writeFileSync(path.join(first, 'file.txt'), 'temporary')
    temp.cleanupSync()
    assert.equal(fs.existsSync(first), false)
    const second = temp.mkdirSync('krwa-temp-async-')
    await new Promise((resolve, reject) => temp.cleanup(error => error ? reject(error) : resolve()))
    assert.equal(fs.existsSync(second), false)
})
