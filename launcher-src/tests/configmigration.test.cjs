const test = require('node:test')
const assert = require('node:assert/strict')

const { CURRENT_CONFIG_VERSION, migrateConfig } = require('../app/assets/js/configmigration')

test('legacy launcher settings migrate autoconnect to disabled once', () => {
    const config = {
        settings: {
            game: {
                autoConnect: true
            }
        }
    }

    migrateConfig(config)

    assert.equal(config.configVersion, CURRENT_CONFIG_VERSION)
    assert.equal(config.settings.game.autoConnect, false)
})

test('explicit autoconnect choice is preserved after migration', () => {
    const config = {
        configVersion: CURRENT_CONFIG_VERSION,
        settings: {
            game: {
                autoConnect: true
            }
        }
    }

    migrateConfig(config)

    assert.equal(config.settings.game.autoConnect, true)
})

test('invalid legacy config values recover to the current schema', () => {
    const config = migrateConfig(null)

    assert.equal(config.configVersion, CURRENT_CONFIG_VERSION)
    assert.equal(config.settings.game.autoConnect, false)
})
