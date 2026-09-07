import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { publicServer, serverStatus, varint, createCommunityServer } from './server.mjs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'

test('public catalog includes Fabric and NeoForge mods but excludes internal data', () => {
    const result = publicServer({ id: 'create', name: 'Create', address: 'private:25565', javaOptions: {}, modules: [{ type: 'FabricMod', name: 'Create', id: 'x:create:1', artifact: { url: 'secret' } }, { type: 'ForgeMod', name: 'Aeronautics', id: 'x:aeronautics:2' }, { type: 'Library' }] }, { state: 'unavailable' })
    assert.deepEqual(result.mods, [{ name: 'Create', version: '1' }, { name: 'Aeronautics', version: '2' }])
    assert.equal(JSON.stringify(result).includes('private'), false)
    assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('status supports fragmented packets and returns only counts', async () => {
    const body = Buffer.from(JSON.stringify({ players: { online: 3, max: 20, sample: [{ name: 'private-player' }] } }))
    const packet = Buffer.concat([varint(0), varint(body.length), body])
    const frame = Buffer.concat([varint(packet.length), packet])
    const server = createServer(socket => socket.once('data', () => { socket.write(frame.subarray(0, 2)); setTimeout(() => socket.end(frame.subarray(2)), 10) }))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
        const status = await serverStatus(`127.0.0.1:${server.address().port}`)
        assert.equal(status.state, 'online'); assert.equal(status.online, 3); assert.equal(status.max, 20)
        assert.equal('sample' in status, false)
    } finally { server.close() }
})

test('unresponsive server returns unknown, never a fabricated zero online', async () => {
    const sockets = []
    const server = createServer(socket => sockets.push(socket))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try { assert.deepEqual(await serverStatus(`127.0.0.1:${server.address().port}`, 30), { state: 'unavailable' }) }
    finally { sockets.forEach(s => s.destroy()); server.close() }
})

test('stable download alias follows the published manifest and rejects arbitrary filenames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'krwa-catalog-'))
    await mkdir(join(directory, 'downloads'))
    const manifest = join(directory, 'downloads/latest.yml')
    const server = createCommunityServer(directory)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/download/windows`
    try {
        for (const version of ['0.1.4', '0.1.5']) {
            await writeFile(manifest, `version: ${version}\npath: KRWA-Launcher-setup-${version}.exe\n`)
            const response = await fetch(url, { redirect: 'manual' })
            assert.equal(response.status, 302)
            assert.equal(response.headers.get('location'), `/downloads/KRWA-Launcher-setup-${version}.exe`)
            assert.equal(response.headers.get('cache-control'), 'no-store')
        }
        await writeFile(manifest, 'version: 1\npath: https://untrusted.example/file.exe\n')
        assert.equal((await fetch(url, { redirect: 'manual' })).status, 404)
    } finally {
        server.close()
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
        assert(basename(directory).startsWith('krwa-catalog-'))
        await rm(directory, { recursive: true })
    }
})

test('macOS download alias selects the universal DMG from the update manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'krwa-catalog-'))
    await mkdir(join(directory, 'downloads'))
    const manifest = join(directory, 'downloads/latest-mac.yml')
    const server = createCommunityServer(directory)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/download/macos`
    try {
        await writeFile(manifest, [
            'version: 0.1.13',
            'files:',
            '  - url: KRWA-Launcher-0.1.13-mac-universal.zip',
            '    sha512: zip-hash',
            '  - url: KRWA-Launcher-0.1.13-mac-universal.dmg',
            '    sha512: dmg-hash',
            'path: KRWA-Launcher-0.1.13-mac-universal.zip',
            '',
        ].join('\n'))
        const response = await fetch(url, { redirect: 'manual' })
        assert.equal(response.status, 302)
        assert.equal(response.headers.get('location'), '/downloads/KRWA-Launcher-0.1.13-mac-universal.dmg')
        assert.equal(response.headers.get('cache-control'), 'no-store')

        await writeFile(manifest, 'version: 1\nfiles:\n  - url: https://untrusted.example/file.dmg\n')
        assert.equal((await fetch(url, { redirect: 'manual' })).status, 404)
    } finally {
        server.close()
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
        assert(basename(directory).startsWith('krwa-catalog-'))
        await rm(directory, { recursive: true })
    }
})
