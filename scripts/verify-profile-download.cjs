const fs = require('node:fs/promises')
const path = require('path')
const { createRequire } = require('node:module')
const requireFromLauncher = createRequire(path.join(__dirname, '..', 'launcher-src', 'package.json'))
const { HeliosDistribution } = requireFromLauncher('helios-core/common')
const {
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadQueue,
    getExpectedDownloadSize
} = requireFromLauncher('helios-core/dl')

async function main(){
    const [distributionPath, serverId, testRoot, publicPrefix, replacementPrefix] = process.argv.slice(2)
    if(!distributionPath || !serverId || !testRoot){
        throw new Error('Usage: node verify-profile-download.cjs <distribution.json> <server-id> <test-root> [public-prefix] [replacement-prefix]')
    }

    const raw = JSON.parse(await fs.readFile(distributionPath, 'utf8'))
    const server = raw.servers.find(candidate => candidate.id === serverId)
    if(!server){
        throw new Error(`Server profile not found: ${serverId}`)
    }

    const rewriteUrls = modules => {
        for(const module of modules){
            if(publicPrefix && replacementPrefix && module.artifact.url.startsWith(publicPrefix)){
                module.artifact.url = replacementPrefix + module.artifact.url.substring(publicPrefix.length)
            }
            rewriteUrls(module.subModules ?? [])
        }
    }
    rewriteUrls(server.modules)

    const commonDir = path.join(testRoot, 'common')
    const instanceDir = path.join(testRoot, 'instances')
    await fs.mkdir(commonDir, { recursive: true })
    await fs.mkdir(instanceDir, { recursive: true })
    const distribution = new HeliosDistribution(raw, commonDir, instanceDir)
    const processors = [
        new MojangIndexProcessor(commonDir, server.minecraftVersion),
        new DistributionIndexProcessor(commonDir, distribution, serverId)
    ]

    let stages = 0
    for(const processor of processors){
        await processor.init()
        stages += processor.totalStages()
    }

    const assets = []
    let completed = 0
    for(const processor of processors){
        const result = await processor.validate(async () => {
            completed++
            if(completed === stages || completed % 250 === 0){
                process.stdout.write(`Validated ${completed}/${stages} stages.\n`)
            }
        })
        Object.values(result).flat().forEach(asset => assets.push(asset))
    }

    process.stdout.write(`Downloading ${assets.length} files (${getExpectedDownloadSize(assets)} bytes).\n`)
    let lastPercent = -1
    await downloadQueue(assets, received => {
        const percent = Math.trunc((received / getExpectedDownloadSize(assets)) * 100)
        if(percent >= lastPercent + 10){
            lastPercent = percent
            process.stdout.write(`${percent}%\n`)
        }
    })
    for(const processor of processors){
        await processor.postDownload()
    }

    const invalidAfterDownload = []
    for(const processor of processors){
        const result = await processor.validate(async () => {})
        Object.values(result).flat().forEach(asset => invalidAfterDownload.push(asset))
    }
    if(invalidAfterDownload.length > 0){
        throw new Error(`${invalidAfterDownload.length} files failed post-download validation.`)
    }
    process.stdout.write('Profile download and hash validation passed.\n')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
