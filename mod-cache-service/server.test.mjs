import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { buildAllowlist, cacheFilePath } from './server.mjs'

const validArtifact = {
    id: 'curseforge.project-1:file:2@jar',
    name: 'Example Mod',
    artifact: {
        url: 'https://mediafilez.forgecdn.net/files/1234/567/example%20mod.jar',
        MD5: '0123456789abcdef0123456789abcdef',
        size: 42
    }
}

test('allowlist contains only exact official CurseForge CDN artifacts', () => {
    const lock = {
        modules: [
            validArtifact,
            { artifact: { ...validArtifact.artifact, url: 'https://example.com/files/1234/567/example.jar' } },
            { artifact: { ...validArtifact.artifact, url: 'https://mediafilez.forgecdn.net/other/1234/567/example.jar' } }
        ]
    }
    const allowlist = buildAllowlist(lock)

    assert.equal(allowlist.size, 1)
    assert.equal(allowlist.get('/files/1234/567/example mod.jar').md5, validArtifact.artifact.MD5)
})

test('nested modules are included and cache names contain only trusted hashes', () => {
    const allowlist = buildAllowlist({ modules: [{ subModules: [validArtifact] }] })
    const artifact = [...allowlist.values()][0]
    const result = cacheFilePath('/cache', artifact)

    assert.equal(result, path.join('/cache', '01', '0123456789abcdef0123456789abcdef.jar'))
})

test('invalid integrity metadata is rejected', () => {
    assert.throws(() => buildAllowlist({
        modules: [{
            ...validArtifact,
            artifact: { ...validArtifact.artifact, MD5: 'not-an-md5' }
        }]
    }), /Invalid cached artifact metadata/)
})
