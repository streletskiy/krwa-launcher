const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')
const Lang = require('../app/assets/js/langloader')

const appPath = path.resolve(__dirname, '../app/app.ejs')
const landingPath = path.resolve(__dirname, '../app/assets/js/scripts/landing.js')
const uiCorePath = path.resolve(__dirname, '../app/assets/js/scripts/uicore.js')
const themePath = path.resolve(__dirname, '../app/assets/css/krwa-theme.css')

test('landing script only references controls that exist in the rendered launcher', async () => {
    Lang.setupLanguage('ru_RU', ['ru-RU'])
    const html = await ejs.renderFile(appPath, {
        launcherVersion: 'test', bkid: 0,
        lang: Lang.queryEJS, native: Lang.native,
        language: () => 'ru-RU'
    })
    const source = fs.readFileSync(landingPath, 'utf8')
    const referencedIds = [...source.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)]
        .map(match => match[1])
    const missingIds = [...new Set(referencedIds)]
        .filter(id => !html.includes(`id="${id}"`))
    assert.deepEqual(missingIds, [])
    assert.ok(source.includes("document.getElementById('launcherLanguageButton')"))
    assert.ok(!source.includes("document.getElementById('launcherLanguage')"))
})

test('launch progress spans the full card and unknown stages are indeterminate', () => {
    const source = fs.readFileSync(landingPath, 'utf8')
    const theme = fs.readFileSync(themePath, 'utf8')
    assert.ok(source.includes("launch_details.style.display = blocked ? 'grid' : 'none'"))
    assert.ok(source.includes("launch_progress.removeAttribute('value')"))
    assert.match(theme, /#launch_progress\s*\{[^}]*grid-column:\s*1 \/ -1;/)
    assert.match(theme, /#launch_progress:indeterminate\s*\{/)
})

test('download stage reports the file count in every language', () => {
    for(const language of ['ru_RU', 'en_US', 'pl_PL']) {
        Lang.setupLanguage(language, [language.replace('_', '-')])
        const text = Lang.queryJS('landing.dlAsync.downloadingFiles', { count: 42 })
        assert.ok(text.includes('42'))
        assert.ok(!text.includes('{count}'))
        assert.ok(Lang.queryJS('landing.dlAsync.distributionTimeout').length > 20)
        assert.ok(Lang.queryJS('landing.systemScan.checkTimeout').length > 10)
    }
})

test('macOS update action uses the stable KRWA download alias', () => {
    const source = fs.readFileSync(uiCorePath, 'utf8')
    assert.ok(source.includes("info.darwindownload = 'https://mc.krwa.ru/download/macos'"))
    assert.ok(!source.includes('github.com/dscalzi/HeliosLauncher/releases'))
})
