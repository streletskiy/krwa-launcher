import { normalize } from 'path'
import { URL } from 'url'

export interface MavenComponents {
    group: string
    artifact: string
    version: string
    classifier?: string
    extension: string
}

export class MavenUtil {

    private static parseIdentifier(id: string, defaultExtension: string): MavenComponents | null {
        if(typeof id !== 'string' || id.length === 0 || id.length > 1024) {
            return null
        }
        const atParts = id.split('@')
        if(atParts.length > 2) {
            return null
        }
        const coordinates = atParts[0].split(':')
        if(coordinates.length < 3 || coordinates.length > 4) {
            return null
        }
        const allowed = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._+-'
        const isSafeComponent = (component: string): boolean => component.length > 0 && component.length <= 256
            && component !== '.' && component !== '..'
            && [...component].every(char => allowed.includes(char))
        const isSafeGroup = (group: string): boolean => group.split('.').every(segment => segment.length > 0)
        if(!coordinates.every(isSafeComponent) || !isSafeGroup(coordinates[0])
            || (atParts[1] != null && !isSafeComponent(atParts[1]))) {
            return null
        }
        return {
            group: coordinates[0],
            artifact: coordinates[1],
            version: coordinates[2],
            classifier: coordinates[3],
            extension: atParts[1] ?? defaultExtension
        }
    }

    public static mavenComponentsToIdentifier(
        group: string,
        artifact: string,
        version: string,
        classifier?: string,
        extension?: string
    ): string {
        return `${group}:${artifact}:${version}${classifier != null ? `:${classifier}` : ''}${extension != null ? `@${extension}` : ''}`
    }

    public static mavenComponentsToExtensionlessIdentifier(
        group: string,
        artifact: string,
        version: string,
        classifier?: string
    ): string {
        return MavenUtil.mavenComponentsToIdentifier(group, artifact, version, classifier)
    }

    public static mavenComponentsToVersionlessIdentifier(
        group: string,
        artifact: string
    ): string {
        return `${group}:${artifact}`
    }

    public static isMavenIdentifier(id: string): boolean {
        return MavenUtil.parseIdentifier(id, 'jar') != null
    }

    public static getMavenComponents(id: string, extension = 'jar'): MavenComponents {
        if (!MavenUtil.isMavenIdentifier(id)) {
            throw new Error('Id is not a maven identifier.')
        }

        const result = MavenUtil.parseIdentifier(id, extension)
        if(result != null) {
            return result
        }

        throw new Error('Failed to process maven data.')
    }

    public static mavenIdentifierAsPath(id: string, extension = 'jar'): string {
        const tmp = MavenUtil.getMavenComponents(id, extension)

        return MavenUtil.mavenComponentsAsPath(
            tmp.group, tmp.artifact, tmp.version, tmp.classifier, tmp.extension
        )
    }

    public static mavenComponentsAsPath(
        group: string, artifact: string, version: string, classifier?: string, extension = 'jar'
    ): string {
        return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier != null ? `-${classifier}` : ''}.${extension}`
    }

    public static mavenIdentifierToUrl(id: string, extension = 'jar'): URL {
        return new URL(MavenUtil.mavenIdentifierAsPath(id, extension))
    }

    public static mavenComponentsToUrl(
        group: string, artifact: string, version: string, classifier?: string, extension = 'jar'
    ): URL {
        return new URL(MavenUtil.mavenComponentsAsPath(group, artifact, version, classifier, extension))
    }

    public static mavenIdentifierToPath(id: string, extension = 'jar'): string {
        return normalize(MavenUtil.mavenIdentifierAsPath(id, extension))
    }

    public static mavenComponentsAsNormalizedPath(
        group: string, artifact: string, version: string, classifier?: string, extension = 'jar'
    ): string {
        return normalize(MavenUtil.mavenComponentsAsPath(group, artifact, version, classifier, extension))
    }

}
