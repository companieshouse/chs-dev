import { serviceDefinitions, type ServiceGroup } from './services.js';
import { resolveServiceState } from './service-state.js';

export interface ProjectSelections {
    modules: string[];
    services: string[];
    servicesWithLiveUpdate: string[];
    excludedServices: string[];
}

export interface LegacyEdit {
    topic: 'services' | 'modules' | 'development' | 'exclusions';
    action: 'enable' | 'disable' | 'add' | 'remove';
    names: string[];
    dependencies?: boolean;
}

export const selectionKeys = [
    'modules',
    'services',
    'servicesWithLiveUpdate',
    'excludedServices',
] as const;

export function projectSelections(value: unknown): ProjectSelections {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected a state mapping');
    const record = value as Record<string, unknown>;
    const result = {} as ProjectSelections;
    for (const key of selectionKeys) {
        const names = record[key] ?? [];
        if (
            !Array.isArray(names) ||
            names.some((name) => typeof name !== 'string')
        )
            throw new Error(`Invalid ${key} in .chs-dev.yaml`);
        result[key] = [...names];
    }
    return result;
}

export function moduleNames(groups: ServiceGroup[]) {
    return groups
        .filter((group) => group.name !== 'Infrastructure')
        .map((group) => group.name);
}

function validateTargets(
    state: ProjectSelections,
    edit: LegacyEdit,
    groups: ServiceGroup[],
) {
    const definitions = serviceDefinitions(groups);
    const details = resolveServiceState(state, groups);
    for (const name of edit.names) {
        if (edit.topic === 'modules') {
            if (!moduleNames(groups).includes(name))
                throw new Error(`Unknown module: ${name}`);
            continue;
        }
        validateServiceTarget(name, edit, definitions, details);
    }
}
function validateServiceTarget(
    name: string,
    edit: LegacyEdit,
    definitions: ReturnType<typeof serviceDefinitions>,
    details: ReturnType<typeof resolveServiceState>,
) {
    const definition = definitions[name];
    if (!Object.hasOwn(definitions, name) || definition.deprecated)
        throw new Error(`Unknown service: ${name}`);
    if (edit.topic === 'development')
        validateDevelopment(name, edit, definition, details);
    if (edit.topic === 'exclusions' && edit.action === 'add' && definition.base)
        throw new Error(`${name} is required infrastructure.`);
}
function validateDevelopment(
    name: string,
    edit: LegacyEdit,
    definition: ReturnType<typeof serviceDefinitions>[string],
    details: ReturnType<typeof resolveServiceState>,
) {
    if (!definition.development)
        throw new Error(`${name} does not support development mode.`);
    if (edit.action === 'enable' && details[name]?.enabled !== 'Yes')
        throw new Error(`Enable ${name} before enabling development mode.`);
}

function exclusionTargets(
    state: ProjectSelections,
    edit: LegacyEdit,
    groups: ServiceGroup[],
) {
    const targets = new Set(edit.names);
    if (!edit.dependencies) return targets;
    const definitions = serviceDefinitions(groups);
    const enabled = resolveServiceState(state, groups);
    for (const name of edit.names) {
        for (const dependency of definitions[name].dependencies) {
            const shared = Object.keys(definitions).some(
                (other) =>
                    !targets.has(other) &&
                    enabled[other]?.enabled === 'Yes' &&
                    definitions[other].dependencies.includes(dependency),
            );
            if (
                edit.action === 'remove' ||
                (!shared && !definitions[dependency]?.base)
            )
                targets.add(dependency);
        }
    }
    return targets;
}

export function editSelections(
    state: ProjectSelections,
    edit: LegacyEdit,
    groups: ServiceGroup[],
): ProjectSelections {
    validateTargets(state, edit, groups);
    const next = projectSelections(state);
    const keys = {
        services: 'services',
        modules: 'modules',
        development: 'servicesWithLiveUpdate',
        exclusions: 'excludedServices',
    } as const;
    const key = keys[edit.topic];
    const targets =
        edit.topic === 'exclusions'
            ? exclusionTargets(state, edit, groups)
            : new Set(edit.names);
    const add = edit.action === 'enable' || edit.action === 'add';
    next[key] = add
        ? [...new Set([...next[key], ...targets])]
        : next[key].filter((name) => !targets.has(name));
    return next;
}
