const CURRENT_CONFIG_VERSION = 1

function migrateConfig(config) {
    if(config == null || typeof config !== 'object' || Array.isArray(config)) {
        config = {}
    }

    const version = Number.isInteger(config?.configVersion) ? config.configVersion : 0

    if(version < 1) {
        config.settings ??= {}
        config.settings.game ??= {}
        config.settings.game.autoConnect = false
    }

    config.configVersion = Math.max(version, CURRENT_CONFIG_VERSION)
    return config
}

module.exports = { CURRENT_CONFIG_VERSION, migrateConfig }
