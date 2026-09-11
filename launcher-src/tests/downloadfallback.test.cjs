const test = require('node:test')
const assert = require('node:assert/strict')
const {
    downloadQueueWithFallback,
    toLauncherFallbackUrl
} = require('../app/assets/js/downloadfallback')

const sourceUrl = 'https://mediafilez.forgecdn.net/files/8654/89/connector-2.0.0-beta.17%2B1.21.1-full.jar'
const fallbackUrl = 'https://mc.krwa.ru/cf-files/files/8654/89/connector-2.0.0-beta.17%2B1.21.1-full.jar'

test('only official CurseForge artifacts receive a KRWA fallback URL', () => {
    assert.equal(toLauncherFallbackUrl(sourceUrl), fallbackUrl)
    assert.equal(toLauncherFallbackUrl('https://example.com/files/8654/89/mod.jar'), null)
    assert.equal(toLauncherFallbackUrl('http://mediafilez.forgecdn.net/files/8654/89/mod.jar'), null)
    assert.equal(toLauncherFallbackUrl('https://mediafilez.forgecdn.net/not-files/8654/89/mod.jar'), null)
    assert.equal(toLauncherFallbackUrl('not a URL'), null)
})

test('failed CurseForge download retries through KRWA and verifies integrity', async () => {
    const calls = []
    const progress = []
    const assets = [{ id: 'mod', url: sourceUrl, path: 'mod.jar', size: 12, algo: 'MD5', hash: 'abc' }]
    const result = await downloadQueueWithFallback(assets, value => progress.push(value), {
        download: async (url, _path, onProgress) => {
            calls.push(url)
            if(url === sourceUrl) throw new Error('primary unavailable')
            onProgress({ transferred: 12 })
        },
        validate: async () => true,
        logger: { warn() {} }
    })

    assert.deepEqual(calls, [sourceUrl, fallbackUrl])
    assert.equal(progress.at(-1), 12)
    assert.deepEqual(result, { mod: 12 })
})

test('invalid primary content is discarded in favour of a valid fallback', async () => {
    const calls = []
    let validations = 0
    await downloadQueueWithFallback([{
        id: 'mod', url: sourceUrl, path: 'mod.jar', size: 12, algo: 'MD5', hash: 'abc'
    }], () => {}, {
        download: async (url, _path, onProgress) => {
            calls.push(url)
            onProgress({ transferred: 12 })
        },
        validate: async () => ++validations === 2,
        logger: { warn() {} }
    })

    assert.deepEqual(calls, [sourceUrl, fallbackUrl])
    assert.equal(validations, 2)
})

test('forced fallback bypasses the primary source for integration checks', async () => {
    const calls = []
    await downloadQueueWithFallback([{
        id: 'mod', url: sourceUrl, path: 'mod.jar', size: 12, algo: 'MD5', hash: 'abc'
    }], () => {}, {
        download: async (url, _path, onProgress) => {
            calls.push(url)
            onProgress({ transferred: 12 })
        },
        validate: async () => true,
        logger: { warn() {} },
        forceFallback: true
    })
    assert.deepEqual(calls, [fallbackUrl])
})

test('temporary fallback failures are retried', async () => {
    const calls = []
    await downloadQueueWithFallback([{
        id: 'mod', url: sourceUrl, path: 'mod.jar', size: 12, algo: 'MD5', hash: 'abc'
    }], () => {}, {
        download: async (url, _path, onProgress) => {
            calls.push(url)
            if(calls.length < 3) throw new Error('temporary proxy failure')
            onProgress({ transferred: 12 })
        },
        validate: async () => true,
        logger: { warn() {} },
        forceFallback: true,
        retryDelayMs: 0
    })
    assert.deepEqual(calls, [fallbackUrl, fallbackUrl, fallbackUrl])
})

test('non-CurseForge failures are not sent through the fallback proxy', async () => {
    const url = 'https://libraries.minecraft.net/library.jar'
    const calls = []
    await assert.rejects(downloadQueueWithFallback([{
        id: 'library', url, path: 'library.jar', size: 1, algo: 'MD5', hash: 'abc'
    }], () => {}, {
        download: async attemptedUrl => {
            calls.push(attemptedUrl)
            throw new Error('offline')
        },
        validate: async () => true,
        logger: { warn() {} }
    }), /offline/)
    assert.deepEqual(calls, [url])
})
