import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MavenUtil } from '../dist/util/MavenUtil.js'
import { MinecraftVersion } from '../dist/util/MinecraftVersion.js'
import { VersionUtil } from '../dist/util/VersionUtil.js'

test('Minecraft versions are parsed without ambiguous or unbounded patterns', () => {
    for(const version of ['1.21.1', '1.20.6-pre1', '26.2']) {
        assert.equal(MinecraftVersion.isMinecraftVersion(version), true)
        assert.equal(new MinecraftVersion(version).toString(), version)
    }
    for(const version of ['', '1', '1.2.3.4', '1.2-../escape', `1.2-${'a'.repeat(129)}`]) {
        assert.equal(MinecraftVersion.isMinecraftVersion(version), false)
    }
})

test('Maven identifiers reject path and control characters', () => {
    assert.deepEqual(MavenUtil.getMavenComponents('net.fabricmc:fabric-loader:0.16.14'), {
        group: 'net.fabricmc', artifact: 'fabric-loader', version: '0.16.14', classifier: undefined, extension: 'jar'
    })
    assert.equal(MavenUtil.isMavenIdentifier('net.fabricmc:fabric-loader:0.16.14:client@zip'), true)
    for(const identifier of ['../group:artifact:1.0', 'group:artifact', 'group:..:1.0', '..:artifact:1.0', 'group:artifact:1.0@../jar', 'group:artifact:1.0\nmalicious']) {
        assert.equal(MavenUtil.isMavenIdentifier(identifier), false)
    }
})

test('Fabric profile requests reject unsafe versions before making a request', async () => {
    await assert.rejects(VersionUtil.getFabricProfileJson('1.21.1', '../latest'), /Invalid Fabric/)
    await assert.rejects(VersionUtil.getFabricProfileJson('../../secret', '0.16.14'), /Invalid Fabric/)
})
