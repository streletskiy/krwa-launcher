const fs = require('fs-extra')
const path = require('path')

function isNeoForgeProfile(server, modManifest){
    return modManifest?.id?.startsWith('neoforge-') === true
        || server.modules.some(mdl => mdl.rawModule.type === 'ForgeHosted'
            && mdl.rawModule.id.startsWith('net.neoforged:neoforge:'))
}

function syncNeoForgeMods(gameDir, mods, logger = console) {
    const modsDir = path.join(gameDir, 'mods')
    const stateFile = path.join(gameDir, '.krwa-neoforge-mods.json')
    fs.ensureDirSync(modsDir)

    let previous = []
    if(fs.existsSync(stateFile)){
        try {
            const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
            previous = Array.isArray(parsed.files) ? parsed.files : []
        } catch(err) {
            logger.warn('Could not read the previous NeoForge mod state; preserving existing files.', err)
        }
    }

    const next = mods.map(mod => path.basename(mod.getPath()))
    for(const file of previous){
        if(!next.includes(file) && path.basename(file) === file){
            fs.removeSync(path.join(modsDir, file))
        }
    }

    for(let i = 0; i < mods.length; i++){
        fs.copyFileSync(mods[i].getPath(), path.join(modsDir, next[i]))
    }
    fs.writeFileSync(stateFile, JSON.stringify({ files: next.sort() }, null, 2), 'utf8')
}

module.exports = { isNeoForgeProfile, syncNeoForgeMods }
