const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const ejs = require('ejs')
const Lang = require('../app/assets/js/langloader')
test('detects regional system languages and honours an explicit choice', () => {
    assert.equal(Lang.resolveLanguage('auto', ['pl-PL']), 'pl_PL')
    assert.equal(Lang.resolveLanguage('auto', ['ru-UA']), 'ru_RU')
    assert.equal(Lang.resolveLanguage('pl_PL', ['ru-RU']), 'pl_PL')
    assert.equal(Lang.resolveLanguage('auto', ['zh-CN', 'en-GB']), 'en_US')
})
test('renders the complete launcher in each supported language', async () => {
    for(const language of ['en_US', 'ru_RU', 'pl_PL']) {
        Lang.setupLanguage(language, ['en-US'])
        const html = await ejs.renderFile(path.resolve(__dirname, '../app/app.ejs'), {
            launcherVersion: 'test', bkid: 0,
            lang: Lang.queryEJS, native: Lang.native,
            language: () => language.replace('_', '-')
        })
        assert.ok(html.includes('Polski'))
        assert.ok(html.includes(Lang.queryJS('landing.launch.play')))
        assert.ok(!html.includes('undefined'))
        if(language !== 'ru_RU') assert.ok(!html.includes('Пароль'))
    }
})
