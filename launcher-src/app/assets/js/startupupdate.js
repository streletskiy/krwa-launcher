// Only startup may restart automatically. Later checks remain non-disruptive.
class StartupUpdate {
    constructor(updater, notify, { checkTimeout = 15000, downloadTimeout = 45000, installDelay = 500 } = {}) {
        this.updater = updater
        this.notify = notify
        this.checkTimeout = checkTimeout
        this.downloadTimeout = downloadTimeout
        this.installDelay = installDelay
        this.active = false
    }
    start() {
        if (this.active) return
        this.active = true
        this.listeners = {
            'update-available': info => { this.arm(this.downloadTimeout); this.notify('startup-downloading', { version: info.version, percent: 0 }) },
            'download-progress': info => { this.arm(this.downloadTimeout); this.notify('startup-downloading', { percent: info.percent, transferred: info.transferred, total: info.total }) },
            'update-not-available': () => this.finish(),
            error: () => this.finish(),
            'update-downloaded': () => {
                this.cleanup()
                this.updater.on('error', this.listeners.error)
                this.notify('startup-installing')
                this.timer = setTimeout(() => {
                    try {
                        this.updater.quitAndInstall(true, true)
                        if (this.active) this.arm(15000)
                    } catch { this.finish() }
                }, this.installDelay)
            }
        }
        for (const [event, listener] of Object.entries(this.listeners)) this.updater.on(event, listener)
        this.notify('startup-checking')
        this.arm(this.checkTimeout)
        Promise.resolve().then(() => this.updater.checkForUpdates()).catch(() => this.finish())
    }
    arm(timeout) { clearTimeout(this.timer); this.timer = setTimeout(() => this.finish(), timeout) }
    cleanup() {
        clearTimeout(this.timer)
        for (const [event, listener] of Object.entries(this.listeners || {})) this.updater.removeListener(event, listener)
    }
    finish() {
        if (!this.active) return
        this.active = false
        this.cleanup()
        this.notify('startup-complete')
    }
}
module.exports = StartupUpdate
