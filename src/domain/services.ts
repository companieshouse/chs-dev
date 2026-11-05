import type { MockSupport, ServiceProvider } from './providers.js';

export interface ServiceDefinition {
    dependencies: string[];
    module: string;
    base: boolean;
    deprecated: boolean;
    development?: boolean;
    mock?: MockSupport;
}

export interface ServiceGroup {
    name: string;
    services: string[];
    definitions?: Record<string, ServiceDefinition>;
}

export interface ServiceDetails {
    enabled: 'Yes' | 'No' | 'Unknown';
    mode: 'Service' | 'Development' | 'Mock' | 'Unknown';
    excluded?: boolean;
    mockScenario?: string;
    savedMockScenario?: string;
}

export interface ServiceEdit {
    name: string;
    enabled: boolean;
    development: boolean;
    provider?: ServiceProvider;
    mockScenario?: string;
    exclusions: Record<string, boolean>;
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
