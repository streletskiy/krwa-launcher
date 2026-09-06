const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

const [distributionPath, serverId, testRoot, javaExecutable] = process.argv.slice(2)
if(!distributionPath || !serverId || !testRoot || !javaExecutable){
    throw new Error('Usage: node smoke-launch-profile.cjs <distribution.json> <server-id> <test-root> <java>')
}

const launcherRoot = path.join(__dirname, '..', 'launcher-src')
const requireFromLauncher = createRequire(path.join(launcherRoot, 'package.json'))
const commonDir = path.join(testRoot, 'common')
const instanceDir = path.join(testRoot, 'instances')
const logPath = path.join(testRoot, 'client-smoke.log')
const configManagerPath = path.join(launcherRoot, 'app', 'assets', 'js', 'configmanager.js')
const electronPath = requireFromLauncher.resolve('electron')

const configManager = {
    getInstanceDirectory: () => instanceDir,
    getCommonDirectory: () => commonDir,
    getTempNativeFolder: () => 'krwa-smoke-natives',
    getModConfiguration: () => ({ mods: {} }),
    getJavaExecutable: () => javaExecutable,
    getLaunchDetached: () => false,
    getMaxRAM: () => '8G',
    getMinRAM: () => '2G',
    getJVMOptions: () => [],
    getAutoConnect: () => false,
    getFullscreen: () => false,
    getGameWidth: () => 1280,
    getGameHeight: () => 720
}

require.cache[configManagerPath] = {
    id: configManagerPath,
    filename: configManagerPath,
    loaded: true,
    exports: configManager,
    children: [],
    paths: []
}
require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { ipcRenderer: { sendSync: () => ({ ok: true }) } },
    children: [],
    paths: []
}

const { HeliosDistribution } = requireFromLauncher('helios-core/common')
const { DistributionIndexProcessor, MojangIndexProcessor } = requireFromLauncher('helios-core/dl')
const ProcessBuilder = require(path.join(launcherRoot, 'app', 'assets', 'js', 'processbuilder.js'))

function terminateProcessTree(child){
    if(!child?.pid){
        return
    }
    if(process.platform === 'win32'){
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
        child.kill('SIGTERM')
    }
}

async function main(){
    fs.writeFileSync(logPath, '')
    const raw = JSON.parse(fs.readFileSync(distributionPath, 'utf8'))
    const distribution = new HeliosDistribution(raw, commonDir, instanceDir)
    const server = distribution.getServerById(serverId)
    if(!server){
        throw new Error(`Server profile not found: ${serverId}`)
    }

    const loaderManifest = await new DistributionIndexProcessor(commonDir, distribution, serverId).loadModLoaderVersionJson()
    const vanillaManifest = await new MojangIndexProcessor(commonDir, server.rawServer.minecraftVersion).getVersionJson()
    const authUser = {
        displayName: 'KRWASmokeTest',
        uuid: '00000000000000000000000000000001',
        accessToken: 'krwa-smoke-test-token',
        type: 'mojang'
    }
    const builder = new ProcessBuilder(server, vanillaManifest, loaderManifest, authUser, 'smoke-test')
    const child = builder.build()
    let ready = false
    let shutdownTimer

    const capture = data => {
        const text = data.toString()
        fs.appendFileSync(logPath, text)
        process.stdout.write(text)
        if(!ready && /Sound engine started|OpenAL initialized|Created:.*(?:atlas|textures)|ScreenCustomizationLayer registered: title_screen/i.test(text)){
            ready = true
            process.stdout.write('\nCLIENT_SMOKE_READY\n')
            shutdownTimer = setTimeout(() => terminateProcessTree(child), 10000)
        }
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)

    const timeout = setTimeout(() => {
        process.stderr.write('Client smoke test timed out.\n')
        terminateProcessTree(child)
    }, 15 * 60 * 1000)

    await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => {
            clearTimeout(timeout)
            clearTimeout(shutdownTimer)
            if(ready){
                resolve()
            } else {
                reject(new Error(`Client exited before reaching the main menu (code ${code}).`))
            }
        })
    })
    process.stdout.write(`Client smoke test passed. Log: ${logPath}\n`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
