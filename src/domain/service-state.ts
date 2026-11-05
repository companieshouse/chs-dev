import {
    serviceDefinitions,
    serviceMode,
    type ServiceGroup,
    type ServiceDetails,
} from './services.js';

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
    const excluded = names('excludedServices');
    const definitions = serviceDefinitions(groups);
    const enabled = new Set<string>();
    const visit = (name: string) => {
        if (
            enabled.has(name) ||
            excluded.has(name) ||
            definitions[name]?.deprecated
        )
            return;
        enabled.add(name);
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
                    enabled: enabled.has(name) ? 'Yes' : 'No',
                    mode: serviceMode(name, development.has(name)),
                    ...(excluded.has(name) ? { excluded: true } : {}),
                },
            ]),
        ),
    );
}
