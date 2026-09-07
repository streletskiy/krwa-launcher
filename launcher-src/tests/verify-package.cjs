const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const archivePath = path.resolve(process.argv[2] || '')
const expectedVersion = process.argv[3]

assert.ok(process.argv[2], 'Usage: node tests/verify-package.cjs APP_ASAR VERSION')
assert.ok(expectedVersion, 'Expected launcher version is required')
assert.ok(fs.statSync(archivePath).isFile(), `Package archive not found: ${archivePath}`)

const entries = asar.listPackage(archivePath).map(entry => entry.replaceAll('\\', '/'))
const forbiddenRoots = ['/dist/', '/dist-linux/', '/dist-mac/', '/tests/']
const leakedEntries = entries.filter(entry =>
    forbiddenRoots.some(root => entry === root.slice(0, -1) || entry.startsWith(root)))

assert.deepEqual(leakedEntries, [], `Build-only files leaked into app.asar: ${leakedEntries.slice(0, 10).join(', ')}`)

const packageJson = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'))
assert.equal(packageJson.version, expectedVersion, 'Packaged launcher version does not match the release version')

const maxArchiveBytes = 100 * 1024 * 1024
const archiveBytes = fs.statSync(archivePath).size
assert.ok(archiveBytes < maxArchiveBytes, `app.asar is unexpectedly large: ${archiveBytes} bytes`)

console.log(`Verified ${archivePath}: ${archiveBytes} bytes, version ${expectedVersion}`)
