export interface ServiceDefinition {
    dependencies: string[];
    module: string;
    base: boolean;
    deprecated: boolean;
    development?: boolean;
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
}

export interface ServiceEdit {
    name: string;
    enabled: boolean;
    development: boolean;
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
): ServiceDetails['mode'] {
    return development
        ? 'Development'
        : mockServices.has(name)
          ? 'Mock'
          : 'Service';
}
