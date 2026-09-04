const got = require('got')

const { YGGDRASIL_API_ROOT } = require('./ipcconstants')

const client = got.extend({
    prefixUrl: YGGDRASIL_API_ROOT,
    responseType: 'json',
    throwHttpErrors: false,
    retry: { limit: 0 },
    timeout: { request: 15000 }
})

function messageFromResponse(response) {
    const body = response.body || {}
    return body.errorMessage || body.message || body.msg || body.error || `HTTP ${response.statusCode}`
}

async function post(path, json, accepted = [200]) {
    const response = await client.post(path, { json })
    if (!accepted.includes(response.statusCode)) {
        const error = new Error(messageFromResponse(response))
        error.statusCode = response.statusCode
        error.responseBody = response.body
        throw error
    }
    return response.body
}

exports.authenticate = async function(username, password, clientToken) {
    let session = await post('authserver/authenticate', {
        agent: { name: 'Minecraft', version: 1 },
        username,
        password,
        clientToken,
        requestUser: true
    })

    if (!session.selectedProfile && session.availableProfiles?.length > 0) {
        session = await exports.refresh(session.accessToken, session.clientToken, session.availableProfiles[0])
    }
    return session
}

exports.validate = async function(accessToken, clientToken) {
    const response = await client.post('authserver/validate', {
        json: { accessToken, clientToken },
        responseType: 'text'
    })
    return response.statusCode === 200 || response.statusCode === 204
}

exports.refresh = async function(accessToken, clientToken, selectedProfile) {
    const payload = {
        accessToken,
        clientToken,
        requestUser: true
    }
    if (selectedProfile) {
        payload.selectedProfile = selectedProfile
    }
    return post('authserver/refresh', payload)
}

exports.invalidate = async function(accessToken, clientToken) {
    await post('authserver/invalidate', { accessToken, clientToken }, [200, 204])
}

exports.getProfile = async function(uuid) {
    const normalizedUuid = String(uuid).replace(/-/g, '')
    const response = await client.get(`sessionserver/session/minecraft/profile/${normalizedUuid}`, {
        searchParams: { unsigned: 'true' }
    })
    if(response.statusCode !== 200) {
        const error = new Error(messageFromResponse(response))
        error.statusCode = response.statusCode
        throw error
    }
    return response.body
}

exports.getSkinUrl = async function(uuid) {
    const profile = await exports.getProfile(uuid)
    const texturesProperty = profile.properties?.find(property => property.name === 'textures')
    if(!texturesProperty?.value) {
        return null
    }
    const textures = JSON.parse(Buffer.from(texturesProperty.value, 'base64').toString('utf8'))
    return textures.textures?.SKIN?.url || null
}

exports.API_ROOT = YGGDRASIL_API_ROOT
