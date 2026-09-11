const { validateLocalFile } = require('helios-core/common')
const { downloadFile } = require('helios-core/dl')

const CURSEFORGE_CDN_HOST = 'mediafilez.forgecdn.net'
const FALLBACK_BASE_URL = 'https://mc.krwa.ru/cf-files'
const CURSEFORGE_ARTIFACT_PATH = /^\/files\/\d+\/\d+\/[^/]+$/

function toLauncherFallbackUrl(sourceUrl) {
    let parsed
    try {
        parsed = new URL(sourceUrl)
    } catch {
        return null
    }

    if(parsed.protocol !== 'https:'
        || parsed.hostname !== CURSEFORGE_CDN_HOST
        || parsed.port !== ''
        || parsed.username !== ''
        || parsed.password !== ''
        || !CURSEFORGE_ARTIFACT_PATH.test(parsed.pathname)) {
        return null
    }
    return `${FALLBACK_BASE_URL}${parsed.pathname}${parsed.search}`
}

async function downloadQueueWithFallback(assets, onProgress, {
    concurrency = 15,
    download = downloadFile,
    validate = validateLocalFile,
    logger = console,
    forceFallback = false,
    fallbackAttempts = 3,
    retryDelayMs = 1000
} = {}) {
    const receivedEach = new Array(assets.length).fill(0)
    let receivedTotal = 0
    let nextIndex = 0

    const setReceived = (index, transferred) => {
        const normalized = Math.max(0, Number(transferred) || 0)
        receivedTotal += normalized - receivedEach[index]
        receivedEach[index] = normalized
        onProgress(receivedTotal)
    }

    const downloadAndValidate = async (asset, index, url) => {
        await download(url, asset.path, progress => setReceived(index, progress.transferred))
        if(!await validate(asset.path, asset.algo, asset.hash)) {
            const error = new Error(`Downloaded artifact failed integrity validation: ${asset.id}`)
            error.code = 'EINTEGRITY'
            throw error
        }
    }

    const downloadFallback = async (asset, index, fallbackUrl) => {
        let lastError
        for(let attempt = 1; attempt <= fallbackAttempts; attempt++) {
            try {
                await downloadAndValidate(asset, index, fallbackUrl)
                return
            } catch(error) {
                lastError = error
                if(attempt === fallbackAttempts) break
                logger.warn(`KRWA fallback attempt ${attempt} failed for ${asset.id}; retrying.`, error)
                setReceived(index, 0)
                await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt))
            }
        }
        throw lastError
    }

    const worker = async () => {
        while(nextIndex < assets.length) {
            const index = nextIndex++
            const asset = assets[index]
            const fallbackUrl = toLauncherFallbackUrl(asset.url)
            if(forceFallback && fallbackUrl != null) {
                logger.warn(`Using forced KRWA fallback for ${asset.id}.`)
                await downloadFallback(asset, index, fallbackUrl)
                continue
            }
            try {
                await downloadAndValidate(asset, index, asset.url)
            } catch(primaryError) {
                if(fallbackUrl == null) throw primaryError

                logger.warn(`Primary download failed for ${asset.id}; retrying through KRWA fallback.`, primaryError)
                setReceived(index, 0)
                await downloadFallback(asset, index, fallbackUrl)
            }
        }
    }

    const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, assets.length))
    await Promise.all(Array.from({ length: workerCount }, worker))
    return Object.fromEntries(assets.map((asset, index) => [asset.id, receivedEach[index]]))
}

module.exports = {
    downloadQueueWithFallback,
    toLauncherFallbackUrl
}
