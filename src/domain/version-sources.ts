import type { ServiceDefinition } from './services.js';

export const versionSources = [
    'cidev',
    'staging',
    'live',
    'latest',
    'compose',
] as const;
export type VersionSource = (typeof versionSources)[number];
export type AwsEnvironment = 'cidev' | 'staging' | 'live';
export interface VersionSelections {
    versionSource?: VersionSource;
    serviceVersionSources?: Record<string, VersionSource>;
}

export const versionSourceLabels: Record<VersionSource, string> = {
    cidev: 'CIDEV',
    staging: 'Staging',
    live: 'Live',
    latest: 'Latest',
    compose: 'Project default',
};
export const versionProfiles: Record<AwsEnvironment, string> = {
    cidev: 'development-eu-west-2',
    staging: 'staging',
    live: 'live',
};

export function isVersionSource(value: unknown): value is VersionSource {
    return versionSources.includes(value as VersionSource);
}

export function isAwsEnvironment(value: unknown): value is AwsEnvironment {
    return ['cidev', 'staging', 'live'].includes(String(value));
}

export function versionSelections(
    value: Record<string, unknown>,
): VersionSelections {
    const result: VersionSelections = {};
    if (value.versionSource !== undefined) {
        if (!isVersionSource(value.versionSource))
            throw new Error('Invalid versionSource in .chs-dev.yaml');
        result.versionSource = value.versionSource;
    }
    if (value.serviceVersionSources === undefined) return result;
    const overrides = value.serviceVersionSources;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
        throw new Error('Invalid serviceVersionSources in .chs-dev.yaml');
    const entries = Object.entries(overrides);
    for (const [name, source] of entries) {
        if (
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) ||
            !isVersionSource(source)
        )
            throw new Error(`Invalid version source for ${name}.`);
    }
    return { ...result, serviceVersionSources: Object.fromEntries(entries) };
}

export function serviceVersionSource(
    name: string,
    selections: VersionSelections,
): VersionSource {
    return (
        selections.serviceVersionSources?.[name] ??
        selections.versionSource ??
        'cidev'
    );
}

export function environmentVersioned(
    definition?: Pick<ServiceDefinition, 'image' | 'module'>,
): boolean {
    return Boolean(
        definition?.module !== 'Infrastructure' &&
        /\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\//.test(
            definition?.image ?? '',
        ),
    );
}
