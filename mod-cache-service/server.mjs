import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const UPSTREAM_HOST = 'mediafilez.forgecdn.net'
const DEFAULT_LOCK_PATH = '/repository/servers/krwa-aeronautics-1.21.1/neoforge-lock.json'
const DEFAULT_CACHE_ROOT = '/cache'
const DOWNLOAD_TIMEOUT_MS = 60_000
const DIRECT_ATTEMPTS = 2
const PROXY_ATTEMPTS = 3
const WARM_CONCURRENCY = 4

function canonicalArtifactPath(pathname) {
    const match = /^\/cf-files(\/files\/[0-9]+\/[0-9]+\/[^/]+)$/.exec(pathname)
        ?? /^(\/files\/[0-9]+\/[0-9]+\/[^/]+)$/.exec(pathname)

    if (match == null) {
        return null
    }

    try {
        const segments = match[1].split('/')
        const filename = decodeURIComponent(segments.at(-1))
        if (filename.length === 0 || /[\\/\0]/.test(filename)) {
            return null
        }
        segments[segments.length - 1] = filename
        return segments.join('/')
    } catch {
        return null
    }
}

function visitModules(modules, visitor) {
    for (const module of modules ?? []) {
        visitor(module)
        visitModules(module.subModules, visitor)
    }
}

export function buildAllowlist(lock) {
    const allowlist = new Map()

    visitModules(lock.modules, module => {
        const artifact = module.artifact
        if (artifact?.url == null) {
            return
        }

        let url
        try {
            url = new URL(artifact.url)
        } catch {
            return
        }

        if (url.protocol !== 'https:' || url.hostname !== UPSTREAM_HOST || url.search !== '' || url.hash !== '') {
            return
        }

        const key = canonicalArtifactPath(url.pathname)
        if (key == null) {
            return
        }
        const md5 = String(artifact.MD5 ?? '').toLowerCase()
        const size = Number(artifact.size)
        if (!/^[a-f0-9]{32}$/.test(md5) || !Number.isSafeInteger(size) || size <= 0) {
            throw new Error(`Invalid cached artifact metadata for ${module.id ?? artifact.url}`)
        }

        const existing = allowlist.get(key)
        if (existing != null && (existing.md5 !== md5 || existing.size !== size)) {
            throw new Error(`Conflicting cached artifact metadata for ${key}`)
        }

        allowlist.set(key, {
            key,
            url: url.href,
            md5,
            size,
            name: module.name ?? key.split('/').at(-1)
        })
    })

    return allowlist
}

export async function loadAllowlist(lockPath) {
    return buildAllowlist(JSON.parse(await readFile(lockPath, 'utf8')))
}

export function cacheFilePath(cacheRoot, artifact) {
    return path.join(cacheRoot, artifact.md5.slice(0, 2), `${artifact.md5}.jar`)
}

async function md5File(filePath) {
    const hash = createHash('md5')
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk)
    }
    return hash.digest('hex')
}

async function isValidCachedFile(filePath, artifact) {
    try {
        const fileStat = await stat(filePath)
        return fileStat.isFile()
            && fileStat.size === artifact.size
            && await md5File(filePath) === artifact.md5
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false
        }
        throw error
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function downloadToFile(url, destination, artifact, agent, redirects = 0) {
    if (redirects > 5) {
        throw new Error('Too many upstream redirects')
    }

    await new Promise((resolve, reject) => {
        const request = https.get(url, {
            agent,
            headers: {
                'User-Agent': 'KRWA-Mod-Cache/1.0',
                Accept: 'application/octet-stream'
            }
        }, response => {
            if (response.statusCode != null
                && response.statusCode >= 300
                && response.statusCode < 400
                && response.headers.location != null) {
                response.resume()
                const redirected = new URL(response.headers.location, url)
                if (redirected.protocol !== 'https:' || redirected.hostname !== UPSTREAM_HOST) {
                    reject(new Error('Upstream redirect left the official CDN'))
                    return
                }
                downloadToFile(redirected.href, destination, artifact, agent, redirects + 1)
                    .then(resolve, reject)
                return
            }

            if (response.statusCode !== 200) {
                response.resume()
                reject(new Error(`Upstream returned HTTP ${response.statusCode ?? 'unknown'}`))
                return
            }

            const hash = createHash('md5')
            let received = 0
            response.on('data', chunk => {
                received += chunk.length
                hash.update(chunk)
            })

            const output = createWriteStream(destination, { flags: 'wx' })
            pipeline(response, output).then(() => {
                const digest = hash.digest('hex')
                if (received !== artifact.size || digest !== artifact.md5) {
                    reject(new Error(`Integrity check failed for ${artifact.name}`))
                    return
                }
                resolve()
            }, reject)
        })

        request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            request.destroy(new Error('Upstream request timed out'))
        })
        request.on('error', reject)
    })
}

async function attemptDownload(label, attempts, callback) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await callback()
            return
        } catch (error) {
            lastError = error
            if (attempt < attempts) {
                await delay(attempt * 500)
            }
        }
    }
    throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message ?? lastError}`)
}

export function createCache({ cacheRoot, proxyUrl }) {
    const inFlight = new Map()
    const directAgent = new https.Agent({ keepAlive: true, maxSockets: 8 })
    const proxyAgent = proxyUrl === ''
        ? null
        : new https.Agent({
            keepAlive: true,
            maxSockets: 8,
            proxyEnv: { HTTPS_PROXY: proxyUrl, NO_PROXY: '' }
        })

    async function populate(artifact, destination) {
        await mkdir(path.dirname(destination), { recursive: true })
        const temporary = `${destination}.part-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`

        try {
            try {
                await attemptDownload('Direct CDN download', DIRECT_ATTEMPTS, async () => {
                    await unlink(temporary).catch(() => {})
                    await downloadToFile(artifact.url, temporary, artifact, directAgent)
                })
            } catch (directError) {
                if (proxyAgent == null) {
                    throw directError
                }
                console.warn(`Direct download failed for ${artifact.name}; retrying through the configured proxy.`)
                await attemptDownload('Proxied CDN download', PROXY_ATTEMPTS, async () => {
                    await unlink(temporary).catch(() => {})
                    await downloadToFile(artifact.url, temporary, artifact, proxyAgent)
                })
            }

            await rename(temporary, destination)
        } finally {
            await unlink(temporary).catch(() => {})
        }
    }

    async function ensureCached(artifact) {
        const destination = cacheFilePath(cacheRoot, artifact)
        if (await isValidCachedFile(destination, artifact)) {
            return { filePath: destination, status: 'HIT' }
        }

        await unlink(destination).catch(() => {})
        let promise = inFlight.get(artifact.md5)
        if (promise == null) {
            promise = populate(artifact, destination).finally(() => inFlight.delete(artifact.md5))
            inFlight.set(artifact.md5, promise)
        }
        await promise
        return { filePath: destination, status: 'MISS' }
    }

    return { ensureCached }
}

async function warmCache(artifacts, cache) {
    const queue = [...artifacts]
    let warmed = 0
    let failed = 0

    async function worker() {
        while (queue.length > 0) {
            const artifact = queue.shift()
            try {
                await cache.ensureCached(artifact)
                warmed++
            } catch (error) {
                failed++
                console.error(`Unable to cache ${artifact.name}: ${error.message}`)
            }
        }
    }

    await Promise.all(Array.from({ length: WARM_CONCURRENCY }, () => worker()))
    console.log(`Cache warm complete: ${warmed} ready, ${failed} failed.`)
}

function sendText(response, statusCode, message) {
    const body = Buffer.from(message)
    response.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
    })
    response.end(body)
}

export async function startServer(options = {}) {
    const port = Number(options.port ?? process.env.PORT ?? 3002)
    const lockPath = options.lockPath ?? process.env.MOD_CACHE_LOCK_PATH ?? DEFAULT_LOCK_PATH
    const cacheRoot = options.cacheRoot ?? process.env.MOD_CACHE_ROOT ?? DEFAULT_CACHE_ROOT
    const proxyUrl = options.proxyUrl ?? process.env.MOD_CACHE_PROXY_URL ?? ''
    const shouldWarm = options.warm ?? process.env.MOD_CACHE_WARM !== 'false'
    let allowlist = await loadAllowlist(lockPath)
    const cache = createCache({ cacheRoot, proxyUrl })

    const server = http.createServer(async (request, response) => {
        try {
            const pathname = new URL(request.url, 'http://mod-cache.local').pathname
            if (pathname === '/health') {
                sendText(response, 200, `ok ${allowlist.size}`)
                return
            }
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                sendText(response, 405, 'Method not allowed')
                return
            }

            const key = canonicalArtifactPath(pathname)
            const artifact = key == null ? null : allowlist.get(key)
            if (artifact == null) {
                sendText(response, 404, 'Not found')
                return
            }

            const cached = await cache.ensureCached(artifact)
            const etag = `\"${artifact.md5}\"`
            const headers = {
                'Content-Type': 'application/java-archive',
                'Content-Length': artifact.size,
                'Cache-Control': 'public, max-age=31536000, immutable',
                ETag: etag,
                'X-KRWA-Mod-Cache': cached.status
            }

            if (request.headers['if-none-match'] === etag) {
                response.writeHead(304, { ETag: etag, 'X-KRWA-Mod-Cache': cached.status })
                response.end()
                return
            }

            response.writeHead(200, headers)
            if (request.method === 'HEAD') {
                response.end()
                return
            }
            createReadStream(cached.filePath).on('error', error => response.destroy(error)).pipe(response)
        } catch (error) {
            console.error(error)
            if (!response.headersSent) {
                sendText(response, 502, 'Unable to retrieve the requested mod')
            } else {
                response.destroy(error)
            }
        }
    })

    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '0.0.0.0', resolve)
    })
    console.log(`KRWA mod cache listening on ${port}; ${allowlist.size} artifacts allowed.`)

    if (shouldWarm) {
        void warmCache(allowlist.values(), cache)
    }

    return server
}

const isMain = process.argv[1] != null
    && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href

if (isMain) {
    await startServer()
}
