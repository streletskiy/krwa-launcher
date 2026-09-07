export class MinecraftVersion {

    private readonly version: string
    private readonly major: number
    private readonly minor: number
    private readonly revision: number | undefined

    constructor(version: string) {
        const res = MinecraftVersion.parseVersion(version)
        if(res != null) {
            this.version = version
            this.major = res.major
            this.minor = res.minor
            this.revision = res.revision
        } else {
            throw new Error(`${version} is not a valid minecraft version!`)
        }
    }

    public static isMinecraftVersion(version: string): boolean {
        return MinecraftVersion.parseVersion(version) != null
    }

    private static parseVersion(version: string): { major: number, minor: number, revision?: number } | null {
        if(typeof version !== 'string' || version.length === 0 || version.length > 128) {
            return null
        }
        const [numericVersion, ...suffixParts] = version.split('-')
        const numericParts = numericVersion.split('.')
        if(numericParts.length < 2 || numericParts.length > 3
            || numericParts.some(part => part.length === 0 || [...part].some(char => char < '0' || char > '9'))) {
            return null
        }
        if(suffixParts.length > 0) {
            const suffix = suffixParts.join('-')
            const allowed = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-'
            if(suffix.length === 0 || !/[0-9A-Za-z]/.test(suffix[0])
                || [...suffix].some(char => !allowed.includes(char))) {
                return null
            }
        }
        const parsed = numericParts.map(Number)
        if(parsed.some(value => !Number.isSafeInteger(value))) {
            return null
        }
        return { major: parsed[0], minor: parsed[1], revision: parsed[2] }
    }

    public getMajor(): number { return this.major }
    public getMinor(): number { return this.minor }
    public getRevision(): number | undefined { return this.revision }

    public toString(): string { return this.version }

    public compareTo(other: MinecraftVersion): number {
        // Compare major
        if (this.major !== other.major) {
            return this.major - other.major
        }

        // Compare minor
        if (this.minor !== other.minor) {
            return this.minor - other.minor
        }

        // Compare revision (null as 0)
        const thisRevision = this.revision ?? 0
        const otherRevision = other.revision ?? 0
        return thisRevision - otherRevision
    }

    public isGreaterThanOrEqualTo(other: MinecraftVersion): boolean {
        return this.compareTo(other) >= 0
    }

}
