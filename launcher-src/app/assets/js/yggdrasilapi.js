const got = require('got')

const { YGGDRASIL_API_ROOT } = require('./ipcconstants')

const client = got.extend({
    prefixUrl: YGGDRASIL_API_ROOT,
    responseType: 'json',
    throwHttpErrors: false,
    retry: { limit: 0 },
    timeout: { request: 15000 }
})

function boundedPrintableString(value, field, maximumLength) {
    if(typeof value !== 'string' || value.length === 0 || value.length > maximumLength
        || /[^\x21-\x7E]/.test(value)) {
        throw new Error(`Authentication service returned an invalid ${field}.`)
    }
    return value
}

function validateProfile(profile) {
    if(profile == null || typeof profile !== 'object') {
        throw new Error('Authentication service did not return a valid profile.')
    }
    const id = boundedPrintableString(profile.id, 'profile ID', 64).replaceAll('-', '')
    const name = boundedPrintableString(profile.name, 'profile name', 64)
    if(!/^[0-9a-f]{32}$/i.test(id) || !/^[0-9A-Za-z_]{1,64}$/.test(name)) {
        throw new Error('Authentication service returned an invalid profile.')
    }
    return { id, name }
}

function validateSession(body) {
    if(body == null || typeof body !== 'object') {
        throw new Error('Authentication service returned an invalid session.')
    }

    const session = {
        accessToken: boundedPrintableString(body.accessToken, 'access token', 8192),
        clientToken: boundedPrintableString(body.clientToken, 'client token', 512)
    }
    if(body.selectedProfile != null) {
        session.selectedProfile = validateProfile(body.selectedProfile)
    }
    if(body.availableProfiles != null) {
        if(!Array.isArray(body.availableProfiles) || body.availableProfiles.length > 100) {
            throw new Error('Authentication service returned an invalid profile list.')
        }
        session.availableProfiles = body.availableProfiles.map(validateProfile)
    }
    return session
}

function messageFromResponse(response) {
    const body = response.body || {}
    return body.errorMessage || body.message || body.msg || body.error || `HTTP ${response.statusCode}`
}

async function post(path, json, accepted = [200]) {
    const response = await client.post(path, { json })
    if(response.rawBody.length > 1024 * 1024) {
        throw new Error('Authentication service response is too large.')
    }
    if (!accepted.includes(response.statusCode)) {
        const error = new Error(messageFromResponse(response))
        error.statusCode = response.statusCode
        error.responseBody = response.body
        throw error
    }
    return response.body
}

exports.authenticate = async function(username, password, clientToken) {
    let session = validateSession(await post('authserver/authenticate', {
        agent: { name: 'Minecraft', version: 1 },
        username,
        password,
        clientToken,
        requestUser: true
    }))

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
    return validateSession(await post('authserver/refresh', payload))
}

exports.invalidate = async function(accessToken, clientToken) {
    await post('authserver/invalidate', { accessToken, clientToken }, [200, 204])
}

exports.getProfile = async function(uuid) {
    const normalizedUuid = String(uuid).replace(/-/g, '')
    if(!/^[0-9a-f]{32}$/i.test(normalizedUuid)) {
        throw new Error('Invalid profile ID.')
    }
    const response = await client.get(`sessionserver/session/minecraft/profile/${normalizedUuid}`, {
        searchParams: { unsigned: 'true' }
    })
    if(response.rawBody.length > 1024 * 1024) {
        throw new Error('Profile service response is too large.')
    }
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
    if(typeof texturesProperty.value !== 'string' || texturesProperty.value.length > 1024 * 1024) {
        throw new Error('Profile service returned invalid texture data.')
    }
    const textures = JSON.parse(Buffer.from(texturesProperty.value, 'base64').toString('utf8'))
    const skinUrlValue = textures.textures?.SKIN?.url
    if(skinUrlValue == null) {
        return null
    }
    const skinUrl = new URL(skinUrlValue)
    if(skinUrl.protocol !== 'https:' || skinUrl.origin !== new URL(YGGDRASIL_API_ROOT).origin) {
        throw new Error('Profile service returned an untrusted texture URL.')
    }
    return skinUrl.toString()
}

exports.API_ROOT = YGGDRASIL_API_ROOT
exports.validateSession = validateSession
