const CustomAuth = require('./yggdrasilapi')
const { LoggerUtil } = require('helios-core')

const log = LoggerUtil.getLogger('SkinManager')

/**
 * Render the face and hat layers directly from the skin served by Aster.
 * The UUID marker prevents a late response from replacing a newly selected
 * account's skin.
 */
exports.applyHead = async function(element, uuid) {
    if(!element) {
        return
    }

    const normalizedUuid = uuid ? String(uuid).replace(/-/g, '') : ''
    element.dataset.skinUuid = normalizedUuid
    element.classList.add('skinHeadPreview')
    element.style.backgroundImage = ''

    if(!normalizedUuid) {
        return
    }

    try {
        const skinUrl = await CustomAuth.getSkinUrl(normalizedUuid)
        if(skinUrl && element.dataset.skinUuid === normalizedUuid) {
            const safeUrl = encodeURI(skinUrl).replace(/"/g, '%22').replace(/'/g, '%27')
            element.style.backgroundImage = `url("${safeUrl}"), url("${safeUrl}")`
        }
    } catch(error) {
        log.warn(`Unable to load skin for ${normalizedUuid}.`, error)
    }
}
