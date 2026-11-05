import {
    serviceDefinitions,
    serviceMode,
    type ServiceGroup,
    type ServiceDetails,
} from './services.js';
import {
    providerSelections,
    selectedProvider,
    validateProviderSelections,
    type ProviderSelections,
} from './providers.js';
import { imageSelections, validateImageSelections } from './image-versions.js';

export function resolveServiceState(
    value: unknown,
    groups: ServiceGroup[],
): Record<string, ServiceDetails> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected a state mapping');
    const state = value as Record<string, unknown>;
    const names = (key: string): Set<string> => {
        const value = state[key] ?? [];
        if (
            !Array.isArray(value) ||
            value.some((item) => typeof item !== 'string')
        )
            throw new Error(`Invalid ${key} in .chs-dev.yaml`);
        return new Set(value);
    };
    const modules = names('modules');
    const requested = names('services');
    const development = names('servicesWithLiveUpdate');
    const excluded = new Set([
        ...names('excludedServices'),
        ...names('excludedFiles'),
    ]);
    const definitions = serviceDefinitions(groups);
    const providers = providerSelections(state);
    const images = imageSelections(state);
    validateImageSelections(images, definitions);
    const selections = {
        ...providers,
        servicesWithLiveUpdate: [...development],
    };
    validateProviderSelections(providers, definitions);
    const enabled = new Set<string>();
    const visit = (name: string) => {
        if (
            enabled.has(name) ||
            excluded.has(name) ||
            definitions[name]?.deprecated
        )
            return;
        enabled.add(name);
        if (selectedProvider(name, selections) === 'mock') return;
        for (const dependency of definitions[name]?.dependencies ?? [])
            visit(dependency);
    };
    for (const [name, definition] of Object.entries(definitions)) {
        if (
            requested.has(name) ||
            modules.has(definition.module) ||
            definition.base
        )
            visit(name);
    }
    return Object.fromEntries(
        groups.flatMap((group) =>
            group.services.map((name) => [
                name,
                {
                    ...resolvedDetails(name, {
                        enabled,
                        development,
                        excluded,
                        providers,
                        definitions,
                    }),
                    ...(images.serviceImages?.[name]
                        ? {
                              image: images.serviceImages[name],
                              imagePinned: true,
                          }
                        : {}),
                },
            ]),
        ),
    );
}

function resolvedDetails(
    name: string,
    context: {
        enabled: Set<string>;
        development: Set<string>;
        excluded: Set<string>;
        providers: ProviderSelections;
        definitions: ReturnType<typeof serviceDefinitions>;
    },
): ServiceDetails {
    const { enabled, development, excluded, providers, definitions } = context;
    const details: ServiceDetails = {
        enabled: enabled.has(name) ? 'Yes' : 'No',
        mode: serviceMode(
            name,
            development.has(name),
            providers.serviceProviders?.[name],
        ),
    };
    if (providers.serviceProviders?.[name] === 'mock')
        details.mockScenario =
            providers.mockScenarios?.[name] ??
            definitions[name].mock!.defaultScenario;
    else if (providers.mockScenarios?.[name])
        details.savedMockScenario = providers.mockScenarios[name];
    if (excluded.has(name)) details.excluded = true;
    return details;
}
