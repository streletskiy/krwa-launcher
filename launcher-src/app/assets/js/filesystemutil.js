const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')

function removeTemporaryFile(file) {
    try {
        fs.unlinkSync(file)
    } catch(err) {
        if(err.code !== 'ENOENT') {
            throw err
        }
    }
}

/**
 * Write a file through a private, exclusively-created sibling and then rename it
 * into place. This avoids following a link swapped in between an existence check
 * and a write, and prevents a partial configuration file after a crash.
 */
function atomicWriteFileSync(file, data, options = {}) {
    const directory = path.dirname(file)
    fs.ensureDirSync(directory, { mode: 0o700 })
    const temporaryFile = path.join(
        directory,
        `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(16).toString('hex')}.tmp`
    )
    const writeOptions = typeof options === 'string' ? { encoding: options } : { ...options }

    try {
        fs.writeFileSync(temporaryFile, data, {
            ...writeOptions,
            flag: 'wx',
            mode: 0o600
        })
        fs.renameSync(temporaryFile, file)
        fs.chmodSync(file, 0o600)
    } finally {
        removeTemporaryFile(temporaryFile)
    }
}

function readFileIfExistsSync(file, options) {
    try {
        return fs.readFileSync(file, options)
    } catch(err) {
        if(err.code === 'ENOENT') {
            return null
        }
        throw err
    }
}

/**
 * Create an unpredictable, user-private directory for extracted native files.
 */
function createPrivateTempDirectory(parentDirectory) {
    fs.ensureDirSync(parentDirectory, { mode: 0o700 })
    const directory = fs.mkdtempSync(path.join(parentDirectory, 'natives-'))
    fs.chmodSync(directory, 0o700)
    return directory
}

/**
 * Resolve an archive entry inside a freshly-created extraction root.
 * Both slash styles are handled so a malicious cross-platform archive cannot
 * use an absolute path or parent traversal on Windows.
 */
function resolveArchiveEntry(root, entryName, flatten = false) {
    if(typeof entryName !== 'string' || entryName.length === 0 || entryName.includes('\0')) {
        throw new Error('Archive contains an invalid entry name.')
    }

    const normalizedName = entryName.replaceAll('\\', '/')
    const segments = normalizedName.split('/')
    if(normalizedName.startsWith('/') || /^[A-Za-z]:/.test(normalizedName) || segments.includes('..')) {
        throw new Error(`Archive entry escapes the extraction directory: ${entryName}`)
    }

    const relativeName = flatten ? path.posix.basename(normalizedName) : normalizedName
    if(relativeName === '' || relativeName === '.' || relativeName === '..') {
        throw new Error('Archive contains an invalid entry name.')
    }

    const resolvedRoot = path.resolve(root)
    const destination = path.resolve(resolvedRoot, ...relativeName.split('/'))
    if(!destination.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Archive entry escapes the extraction directory: ${entryName}`)
    }
    return destination
}

module.exports = {
    atomicWriteFileSync,
    createPrivateTempDirectory,
    readFileIfExistsSync,
    resolveArchiveEntry
}
