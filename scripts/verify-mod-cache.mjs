import assert from 'node:assert/strict'

import { loadAllowlist } from '../mod-cache-service/server.mjs'

const lockPath = new URL('../repository/servers/krwa-aeronautics-1.21.1/neoforge-lock.json', import.meta.url)
const baseUrl = new URL(process.argv[2] ?? 'https://mc.krwa.ru/')
const concurrency = 12
const allowlist = await loadAllowlist(lockPath)
const queue = [...allowlist.values()]
const failures = []
let checked = 0

async function worker() {
    while (queue.length > 0) {
        const artifact = queue.shift()
        const target = new URL(`/cf-files${artifact.key.split('/').map(encodeURIComponent).join('/')}`, baseUrl)
        try {
            const response = await fetch(target, { method: 'HEAD' })
            assert.equal(response.status, 200)
            assert.equal(Number(response.headers.get('content-length')), artifact.size)
            assert.equal(response.headers.get('etag'), `\"${artifact.md5}\"`)
            assert.equal(response.headers.get('x-krwa-mod-cache'), 'HIT')
            checked++
        } catch (error) {
            failures.push(`${target}: ${error.message}`)
        }
    }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()))

if (failures.length > 0) {
    throw new AggregateError(failures.map(message => new Error(message)), `${failures.length} cache checks failed`)
}

console.log(`Verified ${checked} cached CurseForge artifacts through ${baseUrl.origin}.`)
