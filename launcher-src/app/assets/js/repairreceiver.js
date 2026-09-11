const fs = require('fs')
const { DistributionAPI } = require('helios-core/common')
const {
    DistributionIndexProcessor,
    MojangIndexProcessor,
    getExpectedDownloadSize
} = require('helios-core/dl')
const { LoggerUtil } = require('helios-core')
const got = require('got')
const { downloadQueueWithFallback } = require('./downloadfallback')

const log = LoggerUtil.getLogger('RepairReceiver')
const processors = []
let assets = []

async function validate(message) {
    const api = new DistributionAPI(
        message.launcherDirectory,
        message.commonDirectory,
        message.instanceDirectory,
        null,
        message.devMode
    )
    const distribution = await api.getDistributionLocalLoadOnly()
    const server = distribution.getServerById(message.serverId)
    processors.splice(0, processors.length,
        new MojangIndexProcessor(message.commonDirectory, server.rawServer.minecraftVersion),
        new DistributionIndexProcessor(message.commonDirectory, distribution, message.serverId)
    )

    let stageCount = 0
    for(const processor of processors) {
        await processor.init()
        stageCount += processor.totalStages()
    }

    assets = []
    let completedStages = 0
    for(const processor of processors) {
        Object.values(await processor.validate(async () => {
            completedStages++
            process.send({
                response: 'validateProgress',
                percent: Math.trunc((completedStages / stageCount) * 100)
            })
        })).flat().forEach(asset => assets.push(asset))
    }
    process.send({ response: 'validateComplete', invalidCount: assets.length })
}

async function download() {
    const expectedTotalSize = getExpectedDownloadSize(assets)
    log.debug(`Expected download size ${expectedTotalSize}`)
    let currentPercent = -1
    const receivedEach = await downloadQueueWithFallback(assets, received => {
        const nextPercent = expectedTotalSize === 0 ? 100 : Math.trunc((received / expectedTotalSize) * 100)
        if(currentPercent !== nextPercent) {
            currentPercent = nextPercent
            process.send({ response: 'downloadProgress', percent: currentPercent })
        }
    }, {
        logger: log,
        forceFallback: process.env.KRWA_FORCE_CURSEFORGE_FALLBACK === '1'
    })

    for(const asset of assets) {
        if(asset.size !== receivedEach[asset.id]) {
            log.warn(`Asset ${asset.id} declared ${asset.size} bytes, but ${receivedEach[asset.id]} were received.`)
        }
    }
    for(const processor of processors) await processor.postDownload()
    process.send({ response: 'downloadComplete' })
}

async function parseError(error) {
    if(error instanceof got.RequestError) {
        if(error instanceof got.HTTPError) return `Error during request (HTTP Response ${error.response.statusCode})`
        if(error instanceof got.TimeoutError) return 'Request timed out.'
        if(error.name === 'RequestError') return `Request received no response (${error.code}).`
        return 'Error during request.'
    }
    if(error?.code === 'EINTEGRITY') return 'Downloaded file failed integrity validation.'
    return undefined
}

process.on('message', async message => {
    try {
        if(message.action === 'validate') await validate(message)
        else if(message.action === 'download') await download()
        else throw new Error(`Unknown repair action: ${message.action}`)
    } catch(error) {
        log.error('Error during repair operation', error)
        let displayable
        try {
            displayable = await parseError(error)
        } catch(parseFailure) {
            log.error('Unable to describe repair error.', parseFailure)
        }
        fs.writeSync(process.stdout.fd, 'Error now being propagated back to the transmitter.')
        fs.fsyncSync(process.stdout.fd)
        process.send({ response: 'error', displayable })
        process.exit(1)
    }
})

process.on('unhandledRejection', error => log.error(error))
process.on('disconnect', () => process.exit(0))
