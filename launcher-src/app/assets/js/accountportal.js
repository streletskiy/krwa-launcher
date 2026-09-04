const { YGGDRASIL_API_ROOT } = require('./ipcconstants')
const origin = new URL(YGGDRASIL_API_ROOT).origin
const routes = new Set(['/', '/register', '/login', '/reset-password', '/account', '/account/profiles', '/account/wardrobe', '/account/settings'])

exports.portalURL = function(route = '/account') {
    const url = new URL(route, origin)
    if (url.origin !== origin || !routes.has(url.pathname) || url.username || url.password || url.search) return null
    return url.href
}

exports.isPortalURL = function(value) {
    try {
        const url = new URL(value)
        return url.origin === origin && !url.username && !url.password
    } catch { return false }
}
