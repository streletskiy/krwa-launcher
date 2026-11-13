const test = require('node:test')
const assert = require('node:assert/strict')
const { HeliosDistribution } = require('helios-core/common')
const { detectSteamDeck, getSteamDeckMods } = require('../app/assets/js/steamdeck')
const { findInDirection, readGamepad } = require('../app/assets/js/gamepad')
const distro = require('../../repository/distribution.json')

test('detects both Steam Deck models in Desktop Mode and the Steam Gaming session', () => {
    const hardware = (vendor, board) => name => {
        if (name.endsWith('board_vendor')) return vendor
        if (name.endsWith('board_name')) return board
        throw new Error('Missing DMI data')
    }
    for (const board of ['Jupiter', 'Galileo']) {
        assert.deepEqual(detectSteamDeck('linux', {}, hardware('Valve', board)), { detected: true, gamingMode: false })
    }
    assert.deepEqual(detectSteamDeck('linux', { SteamDeck: '1' }, hardware('', '')), { detected: true, gamingMode: true })
    assert.deepEqual(detectSteamDeck('linux', {}, hardware('Valve', 'Other')), { detected: false, gamingMode: false })
    assert.deepEqual(detectSteamDeck('win32', { SteamDeck: '1' }), { detected: false, gamingMode: false })
})

test('finds the optional Deck mods by stable IDs in the generated distribution', () => {
    const distribution = new HeliosDistribution(distro, 'common', 'instances')
    const server = distribution.getServerById('krwa-aeronautics-1.21.1')
    assert.deepEqual(getSteamDeckMods(server), ['curseforge.project-835847:file', 'curseforge.project-335493:file'])
    assert.deepEqual(getSteamDeckMods({ rawServer: server.rawServer, modules: [] }), [])
    assert.deepEqual(getSteamDeckMods(null), [])
})

test('filters stick drift, prefers the D-pad, and reads the standard button layout', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }))
    assert.equal(readGamepad({ buttons, axes: [0.35, -0.2] }).engaged, false)
    assert.equal(readGamepad({ buttons, axes: [0.55, -0.8] }).direction, 'up')
    for (const index of [0, 2, 5, 14]) buttons[index].pressed = true
    assert.deepEqual(readGamepad({ buttons, axes: [0.2, -1, 0, 0.8] }), {
        direction: 'left', select: true, back: false, keyboard: true, tab: 1, scroll: 0.8, engaged: true
    })
})

test('directional focus favors aligned controls and stays at the edge', () => {
    const item = (left, top) => ({ getBoundingClientRect: () => ({ left, top, width: 30, height: 30 }) })
    const origin = item(30, 40)
    const aligned = item(30, 100)
    const diagonal = item(80, 80)
    assert.equal(findInDirection(origin, [origin, diagonal, aligned], 'down'), aligned)
    assert.equal(findInDirection(origin, [origin, diagonal, aligned], 'left'), null)
})
