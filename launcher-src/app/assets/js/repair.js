const { fork } = require('child_process')
const path = require('path')

class FullRepair {
    constructor(commonDirectory, instanceDirectory, launcherDirectory, serverId, devMode) {
        this.commonDirectory = commonDirectory
        this.instanceDirectory = instanceDirectory
        this.launcherDirectory = launcherDirectory
        this.serverId = serverId
        this.devMode = devMode
        this.receiver = null
    }

    spawnReceiver(additionalEnvVars) {
        if(this.receiver != null) throw new Error('Receiver already spawned!')
        const options = { stdio: 'pipe' }
        if(additionalEnvVars) options.env = { ...process.env, ...additionalEnvVars }
        this.receiver = fork(path.join(__dirname, 'repairreceiver.js'), [], options)
        this.receiver.stdio[1].setEncoding('utf8')
        this.receiver.stdio[1].on('data', data => {
            `${data}`.trim().split('\n').forEach(line => console.log(`\x1b[32m[_]\x1b[0m ${line}`))
        })
        this.receiver.stdio[2].setEncoding('utf8')
        this.receiver.stdio[2].on('data', data => {
            `${data}`.trim().split('\n').forEach(line => console.log(`\x1b[31m[_]\x1b[0m ${line}`))
        })
    }

    destroyReceiver() {
        this.receiver.disconnect()
        this.receiver = null
    }

    get childProcess() {
        return this.receiver
    }

    verifyFiles(onProgress) {
        return this.runOperation({
            action: 'validate',
            commonDirectory: this.commonDirectory,
            instanceDirectory: this.instanceDirectory,
            launcherDirectory: this.launcherDirectory,
            serverId: this.serverId,
            devMode: this.devMode
        }, onProgress, 'validateProgress', 'validateComplete', 'invalidCount')
    }

    download(onProgress) {
        return this.runOperation({ action: 'download' }, onProgress, 'downloadProgress', 'downloadComplete')
    }

    runOperation(message, onProgress, progressResponse, completeResponse, resultField) {
        return new Promise((resolve, reject) => {
            const onMessage = reply => {
                switch(reply.response) {
                    case progressResponse:
                        onProgress(reply.percent)
                        break
                    case completeResponse:
                        this.receiver.removeListener('message', onMessage)
                        resolve(resultField == null ? undefined : reply[resultField])
                        break
                    case 'error':
                        this.receiver.removeListener('message', onMessage)
                        reject(reply)
                        break
                }
            }
            this.receiver.on('message', onMessage)
            this.receiver.send(message)
        })
    }
}

module.exports = { FullRepair }
