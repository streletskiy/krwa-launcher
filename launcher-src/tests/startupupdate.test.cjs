const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const StartupUpdate = require('../app/assets/js/startupupdate')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function setup(check) {
    const updater = new EventEmitter(), events = [], installs = []
    updater.on('error', () => {})
    updater.checkForUpdates = () => check(updater)
    updater.quitAndInstall = (...args) => installs.push(args)
    const boot = new StartupUpdate(updater, (event, info) => events.push({ event, info }), { checkTimeout: 30, downloadTimeout: 40, installDelay: 1 })
    return { updater, events, installs, boot }
}
test('startup downloads, reports progress and installs silently with restart', async () => {
    const s = setup(u => { u.emit('update-available', { version: '0.1.6' }); u.emit('download-progress', { percent: 68, transferred: 68, total: 100 }); u.emit('update-downloaded') })
    s.boot.start(); await delay(15)
    assert.deepEqual(s.installs, [[true, true]])
    assert(s.events.some(e => e.info?.percent === 68))
    assert(s.events.some(e => e.event === 'startup-installing'))
    assert(!s.events.some(e => e.event === 'startup-complete'))
    s.boot.finish()
})
test('no update or network failure releases startup', async () => {
    for (const check of [u => u.emit('update-not-available'), () => Promise.reject(new Error('offline'))]) {
        const s = setup(check); s.boot.start(); await delay(5)
        assert.equal(s.events.at(-1).event, 'startup-complete')
        assert.equal(s.installs.length, 0)
    }
})
test('stalled startup continues and a later background download cannot restart a game', async () => {
    const s = setup(() => new Promise(() => {})); s.boot.start(); await delay(60)
    s.updater.emit('update-downloaded'); await delay(5)
    assert.equal(s.events.at(-1).event, 'startup-complete')
    assert.equal(s.installs.length, 0)
    assert.equal(s.updater.listenerCount('download-progress'), 0)
})
test('installer error returns to launcher and does not loop', async () => {
    const s = setup(u => u.emit('update-downloaded'))
    s.updater.quitAndInstall = () => s.updater.emit('error', new Error('installer failed'))
    s.boot.start(); await delay(15)
    assert.equal(s.events.at(-1).event, 'startup-complete')
    assert.equal(s.boot.active, false)
})
