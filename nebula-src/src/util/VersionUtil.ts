import got from 'got'
import { PromotionsSlim } from '../model/forge/PromotionsSlim.js'
import { MinecraftVersion } from './MinecraftVersion.js'
import { LoggerUtil } from './LoggerUtil.js'
import { FabricInstallerMeta, FabricLoaderMeta, FabricProfileJson, FabricVersionMeta } from '../model/fabric/FabricMeta.js'

export class VersionUtil {

    private static readonly logger = LoggerUtil.getLogger('VersionUtil')

    public static readonly PROMOTION_TYPE = [
        'recommended',
        'latest'
    ]

    public static isVersionAcceptable(version: MinecraftVersion, acceptable: number[]): boolean {
        if (version.getMajor() === 1) {
            return acceptable.find((element) => version.getMinor() === element) != null
        }
        return false
    }

    public static versionGte(version: string, min: string): boolean {

        if(version === min) {
            return true
        }

        const left = version.split('.').map(x => Number(x))
        const right = min.split('.').map(x => Number(x))

        if(left.length != right.length) {
            throw new Error('Cannot compare mismatched versions.')
        }

        for(let i=0; i<left.length; i++) {
            if(left[i] > right[i]) {
                return true
            }
        }

        return false
    }

    public static isPromotionVersion(version: string): boolean {
        return VersionUtil.PROMOTION_TYPE.includes(version.toLowerCase())
    }

    // -------------------------------
    // Forge

    public static isOneDotTwelveFG2(libraryVersion: string): boolean {
        const maxFG2 = [14, 23, 5, 2847]
        const verSplit = libraryVersion.split('.').map(v => Number(v))

        for(let i=0; i<maxFG2.length; i++) {
            if(verSplit[i] > maxFG2[i]) {
                return false
            }
        }
        
        return true
    }

    public static async getPromotionIndex(): Promise<PromotionsSlim> {
        const response = await got.get<PromotionsSlim>({
            method: 'get',
            url: 'https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json',
            responseType: 'json'
        })
        return response.body
    }

    public static getPromotedVersionStrict(index: PromotionsSlim, minecraftVersion: MinecraftVersion, promotion: string): string {
        const workingPromotion = promotion.toLowerCase()
        return index.promos[`${minecraftVersion}-${workingPromotion}`]
    }

    public static async getPromotedForgeVersion(minecraftVersion: MinecraftVersion, promotion: string): Promise<string> {
        const workingPromotion = promotion.toLowerCase()
        const res = await VersionUtil.getPromotionIndex()
        let version = res.promos[`${minecraftVersion}-${workingPromotion}`]
        if (version == null) {
            VersionUtil.logger.warn(`No ${workingPromotion} version found for Forge ${minecraftVersion}.`)
            VersionUtil.logger.warn('Attempting to pull latest version instead.')
            version = res.promos[`${minecraftVersion}-latest`]
            if (version == null) {
                throw new Error(`No latest version found for Forge ${minecraftVersion}.`)
            }
        }
        return version
    }

    // -------------------------------
    // Fabric

    public static async getFabricInstallerMeta(): Promise<FabricInstallerMeta[]> {
        const response = await got.get<FabricInstallerMeta[]>({
            method: 'get',
            url: 'https://meta.fabricmc.net/v2/versions/installer',
            responseType: 'json'
        })
        return response.body
    }

    public static async getFabricLoaderMeta(): Promise<FabricLoaderMeta[]> {
        const response = await got.get<FabricLoaderMeta[]>({
            method: 'get',
            url: 'https://meta.fabricmc.net/v2/versions/loader',
            responseType: 'json'
        })
        return response.body
    }

    public static async getFabricGameMeta(): Promise<FabricVersionMeta[]> {
        const response = await got.get<FabricVersionMeta[]>({
            method: 'get',
            url: 'https://meta.fabricmc.net/v2/versions/game',
            responseType: 'json'
        })
        return response.body
    }

    public static async getFabricProfileJson(gameVersion: string, loaderVersion: string): Promise<FabricProfileJson> {
        if(!MinecraftVersion.isMinecraftVersion(gameVersion)
            || !VersionUtil.isSafeFabricVersion(loaderVersion)) {
            throw new Error('Invalid Fabric or Minecraft version.')
        }

        const response = await got.get({
            method: 'get',
            url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
            responseType: 'buffer'
        })
        if(response.body.length > 1024 * 1024) {
            throw new Error('Fabric metadata service response is too large.')
        }
        const body = JSON.parse(response.body.toString('utf8')) as unknown
        return VersionUtil.validateFabricProfile(body, gameVersion)
    }

    private static validateFabricProfile(body: unknown, gameVersion: string): FabricProfileJson {
        if(body == null || typeof body !== 'object') {
            throw new Error('Fabric metadata service returned an invalid profile.')
        }

        const profile = body as Partial<FabricProfileJson>
        const allowedMainClasses = new Set([
            'net.fabricmc.loader.impl.launch.knot.KnotClient',
            'net.fabricmc.loader.launch.knot.KnotClient'
        ])
        if(profile.inheritsFrom !== gameVersion
            || typeof profile.id !== 'string' || profile.id.length > 256
            || typeof profile.mainClass !== 'string' || !allowedMainClasses.has(profile.mainClass)
            || !Array.isArray(profile.libraries) || profile.libraries.length > 256
            || profile.arguments == null || !Array.isArray(profile.arguments.game) || !Array.isArray(profile.arguments.jvm)) {
            throw new Error('Fabric metadata service returned an invalid profile.')
        }

        for(const library of profile.libraries) {
            if(library == null || typeof library !== 'object'
                || typeof library.name !== 'string'
                || !VersionUtil.isSafeFabricLibrary(library.name)
                || typeof library.url !== 'string') {
                throw new Error('Fabric metadata service returned an invalid library.')
            }
            const libraryUrl = new URL(library.url)
            if(libraryUrl.protocol !== 'https:' || libraryUrl.hostname !== 'maven.fabricmc.net') {
                throw new Error('Fabric metadata service returned an untrusted library URL.')
            }
        }

        return profile as FabricProfileJson
    }

    private static isSafeFabricVersion(version: string): boolean {
        const allowed = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._+~-'
        return typeof version === 'string' && version.length > 0 && version.length <= 128
            && /[0-9A-Za-z]/.test(version[0])
            && [...version].every(char => allowed.includes(char))
    }

    private static isSafeFabricLibrary(identifier: string): boolean {
        const parts = identifier.split(':')
        return parts.length >= 3 && parts.length <= 4
            && parts.every(part => VersionUtil.isSafeFabricVersion(part))
    }

    public static async getPromotedFabricVersion(promotion: string): Promise<string> {
        const stable = promotion.toLowerCase() === 'recommended'
        const fabricLoaderMeta = await this.getFabricLoaderMeta()
        return !stable ? fabricLoaderMeta[0].version : fabricLoaderMeta.find(({ stable }) => stable)!.version
    }

}
