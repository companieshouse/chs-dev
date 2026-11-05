import type { ServiceDefinition, ServiceDetails } from './services.js';

export const serviceProviders = ['service', 'development', 'mock'] as const;
export type ServiceProvider = (typeof serviceProviders)[number];
export interface MockScenario {
    name: string;
    description: string;
}
export interface MockSupport {
    defaultScenario: string;
    scenarios: MockScenario[];
}
export interface ProviderSelections {
    serviceProviders?: Record<string, ServiceProvider>;
    mockScenarios?: Record<string, string>;
}

function selectionMap(value: unknown, key: string): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`Invalid ${key} in .chs-dev.yaml`);
    const entries = Object.entries(value);
    for (const [name, selection] of entries) {
        if (
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) ||
            typeof selection !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(selection)
        )
            throw new Error(`Invalid ${key} in .chs-dev.yaml`);
    }
    return Object.fromEntries(entries);
}

export function providerSelections(
    value: Record<string, unknown>,
): ProviderSelections {
    const result: ProviderSelections = {};
    if (value.serviceProviders !== undefined) {
        const providers = selectionMap(
            value.serviceProviders,
            'serviceProviders',
        );
        if (
            Object.values(providers).some(
                (p) => !serviceProviders.includes(p as ServiceProvider),
            )
        )
            throw new Error('Invalid serviceProviders in .chs-dev.yaml');
        result.serviceProviders = providers as Record<string, ServiceProvider>;
    }
    if (value.mockScenarios !== undefined)
        result.mockScenarios = selectionMap(
            value.mockScenarios,
            'mockScenarios',
        );
    return result;
}

export function selectedProvider(
    name: string,
    state: ProviderSelections & { servicesWithLiveUpdate: readonly string[] },
): ServiceProvider {
    return (
        state.serviceProviders?.[name] ??
        (state.servicesWithLiveUpdate.includes(name)
            ? 'development'
            : 'service')
    );
}

export function validateProvider(
    name: string,
    provider: ServiceProvider,
    definition: Pick<ServiceDefinition, 'base' | 'development' | 'mock'>,
    scenario?: string,
): void {
    if (!serviceProviders.includes(provider))
        throw new Error('Unknown service provider.');
    if (provider === 'development' && !definition.development)
        throw new Error(`${name} does not support development mode.`);
    if (provider !== 'mock') return;
    if (definition.base || !definition.mock)
        throw new Error(
            `${name} has no mock contract. Add one to the chs-dev mocks catalogue.`,
        );
    if (
        scenario &&
        !definition.mock.scenarios.some((item) => item.name === scenario)
    )
        throw new Error(`Unknown mock scenario ${scenario} for ${name}.`);
}

export function detailsProvider(
    details?: ServiceDetails,
    definition?: ServiceDefinition,
): ServiceProvider {
    if (details?.mode === 'Development') return 'development';
    return details?.mode === 'Mock' && definition?.mock ? 'mock' : 'service';
}

export function mockScenarioFor(
    details?: ServiceDetails,
    definition?: ServiceDefinition,
): string | undefined {
    return (
        details?.mockScenario ??
        details?.savedMockScenario ??
        definition?.mock?.defaultScenario
    );
}

export function validateProviderSelections(
    selections: ProviderSelections,
    definitions: Record<string, ServiceDefinition>,
): void {
    for (const [name, provider] of Object.entries(
        selections.serviceProviders ?? {},
    )) {
        const definition = definitions[name];
        if (!definition || definition.deprecated)
            throw new Error(`Unknown service: ${name}`);
        validateProvider(
            name,
            provider,
            definition,
            selections.mockScenarios?.[name],
        );
    }
    for (const [name, scenario] of Object.entries(
        selections.mockScenarios ?? {},
    )) {
        const definition = definitions[name];
        if (!definition || definition.deprecated)
            throw new Error(`Unknown service: ${name}`);
        validateProvider(name, 'mock', definition, scenario);
    }
}
