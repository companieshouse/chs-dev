import type { MockSupport, ServiceProvider } from './providers.js';
import type { VersionSource } from './version-sources.js';
import type { StartMode, StartModeSource } from './start-modes.js';

export interface ServiceDefinition {
    dependencies: string[];
    module: string;
    base: boolean;
    deprecated: boolean;
    /** Default start mode from the `chs.start-mode` Compose label. */
    startMode?: 'lazy' | 'always';
    development?: boolean;
    mock?: MockSupport;
    image?: string;
}

export interface ServiceGroup {
    name: string;
    services: string[];
    definitions?: Record<string, ServiceDefinition>;
}

export interface ServiceDetails {
    enabled: 'Yes' | 'No' | 'Unknown';
    mode: 'Service' | 'Development' | 'Mock' | 'Unknown';
    /** The user's start-mode override from `.chs-dev.yaml`, if any. */
    startModeOverride?: StartMode;
    /** Default start mode from the `chs.start-mode` Compose label. */
    startModeLabel?: StartMode;
    /** Effective start mode for an enabled service, after all rules. */
    effectiveStartMode?: StartMode;
    /** Where the effective start mode came from. */
    startModeSource?: StartModeSource;
    excluded?: boolean;
    mockScenario?: string;
    savedMockScenario?: string;
    image?: string;
    imagePinned?: boolean;
    versionSource?: VersionSource;
    versionSourceOverride?: VersionSource;
    defaultVersionSource?: VersionSource;
    environmentVersionsAvailable?: boolean;
    versionLabel?: string;
}

export interface ServiceEdit {
    name: string;
    enabled: boolean;
    development: boolean;
    provider?: ServiceProvider;
    mockScenario?: string;
    exclusions: Record<string, boolean>;
    image?: string | null;
    versionSource?: VersionSource | null;
    /** Start-mode override to store; null clears it back to the default. */
    startMode?: StartMode | null;
}

export type SaveService = (edit: ServiceEdit) => Promise<void>;

export function serviceDefinitions(
    groups: ServiceGroup[],
): Record<string, ServiceDefinition> {
    return Object.assign({}, ...groups.map((group) => group.definitions ?? {}));
}

const mockServices = new Set([
    'ch-service-mock',
    'chips-filing-mock',
    'sockpuppet',
]);

export function serviceMode(
    name: string,
    development: boolean,
    provider?: ServiceProvider,
): ServiceDetails['mode'] {
    if (provider)
        return { service: 'Service', development: 'Development', mock: 'Mock' }[
            provider
        ] as ServiceDetails['mode'];
    return development
        ? 'Development'
        : mockServices.has(name)
          ? 'Mock'
          : 'Service';
}
