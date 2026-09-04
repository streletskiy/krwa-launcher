import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function varint(value) {
    const bytes = []
    do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)) } while (value)
    return Buffer.from(bytes)
}

export function readVarint(buffer, offset = 0) {
    let value = 0
    for (let i = 0; i < 5; i++) {
        if (offset + i >= buffer.length) return null
        const byte = buffer[offset + i]
        value |= (byte & 127) << (7 * i)
        if (!(byte & 128)) return { value: value >>> 0, size: i + 1 }
    }
    throw new Error('Invalid VarInt')
}

// Only the operator-controlled distribution supplies targets; requests cannot choose a host.
export function serverStatus(address, timeout = 2500) {
    return new Promise((resolve) => {
        let endpoint
        try { endpoint = new URL(`tcp://${address}`) } catch { resolve({ state: 'unavailable' }); return }
        const host = endpoint.hostname.replace(/^\[|\]$/g, '')
        const port = Number(endpoint.port || 25565)
        const started = Date.now()
        let received = Buffer.alloc(0)
        const socket = createConnection({ host, port })
        const timer = setTimeout(() => finish({ state: 'unavailable' }), timeout)
        const finish = (status) => { clearTimeout(timer); socket.destroy(); resolve(status) }
        socket.on('connect', () => {
            const hostBytes = Buffer.from(host)
            const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port)
            const handshake = Buffer.concat([varint(0), varint(0), varint(hostBytes.length), hostBytes, portBytes, varint(1)])
            socket.write(Buffer.concat([varint(handshake.length), handshake, Buffer.from([1, 0])]))
        })
        socket.on('data', (chunk) => {
            received = Buffer.concat([received, chunk])
            try {
                if (received.length > 1024 * 1024) throw new Error('Packet too large')
                const frame = readVarint(received)
                if (!frame) return
                if (frame.value > 1024 * 1024) throw new Error('Packet too large')
                if (received.length < frame.size + frame.value) return
                const packet = received.subarray(frame.size, frame.size + frame.value)
                const id = readVarint(packet)
                if (!id || id.value !== 0) throw new Error('Unexpected packet')
                const length = readVarint(packet, id.size)
                if (!length || id.size + length.size + length.value !== packet.length) throw new Error('Invalid string')
                const data = JSON.parse(packet.subarray(id.size + length.size).toString('utf8'))
                const { online, max } = data.players ?? {}
                if (!Number.isSafeInteger(online) || !Number.isSafeInteger(max) || online < 0 || max < 0) throw new Error('Invalid players')
                finish({ state: 'online', online, max, latencyMs: Date.now() - started })
            } catch { finish({ state: 'unavailable' }) }
        })
        socket.on('error', () => finish({ state: 'unavailable' }))
        socket.on('end', () => finish({ state: 'unavailable' }))
    })
}

export function publicServer(server, status) {
    return {
        id: server.id, name: server.name, description: server.description,
        minecraftVersion: server.minecraftVersion, packVersion: server.version,
        mods: (server.modules ?? []).filter(m => m.type === 'FabricMod').map(m => ({ name: m.name, version: m.id.split(':').at(-1) })),
        status,
    }
}

export async function snapshot(repository) {
    const distribution = JSON.parse(await readFile(join(repository, 'distribution.json'), 'utf8'))
    const servers = await Promise.all(distribution.servers.slice(0, 20).map(async s => publicServer(s, await serverStatus(s.address))))
    const downloads = await downloadLinks(repository)
    return { updatedAt: new Date().toISOString(), servers, downloads }
}

export async function downloadLinks(repository) {
    const downloads = []
    for (const [platform, manifest, pattern] of [['Windows', 'latest.yml', /^KRWA-Launcher-setup-[\w.-]+\.exe$/], ['Linux', 'latest-linux.yml', /^KRWA-Launcher-[\w.-]+\.AppImage$/]]) {
        try {
            const content = await readFile(join(repository, 'downloads', manifest), 'utf8')
            const file = /^path: (.+)$/m.exec(content)?.[1]?.trim()
            const version = /^version: ([\w.-]+)$/m.exec(content)?.[1]
            if (file && pattern.test(file) && version) downloads.push({ platform, version, url: `/download/${platform.toLowerCase()}`, target: `/downloads/${file}` })
        } catch { /* An unpublished platform has no download action. */ }
    }
    return downloads
}

export function createCommunityServer(repository) {
    let cached, expires = 0, pending
    return createServer(async (req, res) => {
        if (['/download/windows', '/download/linux'].includes(req.url) && ['GET', 'HEAD'].includes(req.method)) {
            const download = (await downloadLinks(repository)).find(d => d.url === req.url)
            res.writeHead(download ? 302 : 404, { 'Cache-Control': 'no-store', ...(download ? { Location: download.target } : {}) })
            res.end(); return
        }
        if (req.url !== '/community.json' || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return }
        try {
            if (Date.now() >= expires) {
                pending ??= snapshot(repository).then(data => { cached = data; expires = Date.now() + 15000 }).finally(() => { pending = null })
                await pending
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify(cached))
        } catch { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"unavailable"}') }
    })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    createCommunityServer(process.env.REPOSITORY_PATH || '/repository').listen(Number(process.env.PORT || 3001), '0.0.0.0')
}
