const fs = require('fs-extra')
const path = require('path')
const toml = require('toml')
const merge = require('lodash.merge')
const native = require('../lang/native.json')
let lang, selected = 'en_US'
const supported = ['ru_RU', 'en_US', 'pl_PL']
exports.resolveLanguage = (preference, systemLanguages = []) => {
    if(supported.includes(preference)) return preference
    for(const value of systemLanguages) {
        const found = supported.find(id => id.slice(0, 2) === value.toLowerCase().slice(0, 2))
        if(found) return found
    }
    return 'en_US'
}
function electronApp() {
    const electron = require('electron')
    return electron.app || require('@electron/remote').app
}
function preferenceFile() { return path.join(electronApp().getPath('userData'), 'language.json') }
exports.getPreference = () => {
    try { return JSON.parse(fs.readFileSync(preferenceFile(), 'utf8')).language || 'auto' }
    catch { return 'auto' }
}
exports.setPreference = (language) => {
    if(language !== 'auto' && !supported.includes(language)) throw new Error('Unsupported language')
    fs.outputJsonSync(preferenceFile(), { language })
}
exports.getLanguage = () => selected
exports.loadLanguage = (id) => {
    lang = merge(lang || {}, toml.parse(fs.readFileSync(path.join(__dirname, '..', 'lang', `${id}.toml`))))
}
exports.setupLanguage = (override, systemLanguages) => {
    let system = systemLanguages
    if(!system) {
        try { system = electronApp().getPreferredSystemLanguages() } catch { system = [Intl.DateTimeFormat().resolvedOptions().locale] }
    }
    selected = exports.resolveLanguage(override || exports.getPreference(), system)
    lang = {}
    exports.loadLanguage('en_US')
    lang = merge(lang, require('../lang/krwa-locales.json').en_US)
    if(selected === 'ru_RU') exports.loadLanguage('_custom')
    lang = merge(lang, require('../lang/krwa-locales.json')[selected])
    return selected
}
exports.query = (id, placeholders) => {
    if(!lang) exports.setupLanguage()
    let result = id.split('.').reduce((value, key) => value?.[key], lang)
    if(typeof result !== 'string') throw new Error(`Missing translation: ${id}`)
    for(const [key, value] of Object.entries(placeholders || {})) result = result.replaceAll(`{${key}}`, String(value))
    return result
}
exports.queryJS = (id, placeholders) => exports.query(`js.${id}`, placeholders)
exports.queryEJS = (id, placeholders) => exports.query(`ejs.${id}`, placeholders)
exports.native = (text) => selected === 'ru_RU' ? text : native[text]?.[selected] || native[text]?.en_US || text
