const fs = require('fs-extra')
const path = require('path')
const nbt = require('prismarine-nbt')

// Add the public entry without replacing favourites, icons or resource-pack choices.
exports.ensureServer = function(gameDir, name, address) {
    const file = path.join(gameDir, 'servers.dat')
    const previous = fs.existsSync(file) ? fs.readFileSync(file) : null
    const root = previous ? nbt.parseUncompressed(previous) : nbt.comp({ servers: nbt.list(nbt.comp([])) })
    const list = root.value.servers
    if (list?.type !== 'list' || list.value.type !== 'compound') throw new Error('Invalid Minecraft server list')
    const canonical = value => String(value).toLowerCase().replace(/:25565$/, '')
    if (list.value.value.some(server => canonical(server.ip?.value) === canonical(address))) return false
    list.value.value.push({ name: nbt.string(name), ip: nbt.string(address) })
    const bytes = nbt.writeUncompressed(root)
    if (previous) fs.writeFileSync(`${file}.krwa-backup`, previous)
    const pending = `${file}.krwa-tmp`
    fs.writeFileSync(pending, bytes)
    fs.renameSync(pending, file)
    return true
}
