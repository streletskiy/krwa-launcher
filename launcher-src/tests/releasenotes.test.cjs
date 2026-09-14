const { test } = require('node:test')
const assert = require('node:assert/strict')
const { releaseNotesToPlainText } = require('../app/assets/js/releasenotes')

test('GitHub Atom HTML is rendered as readable plain text', () => {
    const source = '<p>Исправлены <strong>ссылки</strong> &amp; сообщения.</p><ul><li>Windows</li><li>Linux</li></ul>'
    const result = releaseNotesToPlainText(source)

    assert.equal(result, 'Исправлены ссылки & сообщения.\n\n * Windows\n * Linux')
    assert.doesNotMatch(result, /<\/?(?:p|strong|ul|li)>/)
})

test('release note conversion drops active and embedded content', () => {
    const source = '<p>Безопасный текст</p><img src="https://example.invalid/pixel"><script>bad()</script><iframe src="https://example.invalid"></iframe>'
    const result = releaseNotesToPlainText(source)

    assert.equal(result, 'Безопасный текст')
})

test('electron-updater release note arrays are supported', () => {
    const result = releaseNotesToPlainText([
        { version: '0.1.19', note: '<p>Первое изменение</p>' },
        { version: '0.1.18', note: '<p>Второе изменение</p>' }
    ])

    assert.equal(result, 'Первое изменение\n\nВторое изменение')
})
