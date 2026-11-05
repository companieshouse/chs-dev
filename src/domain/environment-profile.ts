import {
    projectSelections,
    moduleNames,
    type ProjectSelections,
} from './configuration.js';
import { resolveServiceState } from './service-state.js';
import { serviceDefinitions, type ServiceGroup } from './services.js';

export interface EnvironmentProfile {
    format: 'chs-dev-environment';
    version: 1;
    createdAt: string;
    projectRevision?: string;
    selections: ProjectSelections;
    mockContracts?: Record<string, string>;
}

export interface ProfileChange {
    service: string;
    field: string;
    before: string;
    after: string;
}

export interface ProfilePreview {
    profile: EnvironmentProfile;
    revision: string;
    changes: ProfileChange[];
    warnings: string[];
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected an environment profile mapping.');
    return value as Record<string, unknown>;
}

export function parseEnvironmentProfile(value: unknown): EnvironmentProfile {
    const profile = record(value);
    validateHeader(profile);
    const selections = record(profile.selections);
    validateSelectionFields(selections);
    const parsed = projectSelections(selections);
    const contracts =
        profile.mockContracts === undefined
            ? undefined
            : record(profile.mockContracts);
    if (
        contracts &&
        Object.values(contracts).some(
            (hash) => !/^[a-f0-9]{64}$/.test(String(hash)),
        )
    )
        throw new Error('Invalid mock contract fingerprint.');
    return {
        format: 'chs-dev-environment',
        version: 1,
        createdAt: String(profile.createdAt),
        ...(profile.projectRevision
            ? { projectRevision: String(profile.projectRevision) }
            : {}),
        selections: parsed,
        ...(contracts
            ? { mockContracts: contracts as Record<string, string> }
            : {}),
    };
}

function validateHeader(profile: Record<string, unknown>) {
    if (profile.format !== 'chs-dev-environment' || profile.version !== 1)
        throw new Error('Unsupported environment profile format or version.');
    if (
        typeof profile.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(profile.createdAt))
    )
        throw new Error('Invalid profile creation time.');
    if (
        profile.projectRevision !== undefined &&
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(profile.projectRevision))
    )
        throw new Error('Invalid project revision.');
}

function validateSelectionFields(selections: Record<string, unknown>) {
    const allowed = new Set([
        'modules',
        'services',
        'servicesWithLiveUpdate',
        'excludedServices',
        'serviceProviders',
        'mockScenarios',
        'serviceImages',
        'excludedFiles',
        'versionSource',
        'serviceVersionSources',
    ]);
    if (Object.keys(selections).some((key) => !allowed.has(key)))
        throw new Error('Unknown environment selection field.');
}

export function profileSelections(
    current: ProjectSelections,
    profile: EnvironmentProfile,
    versionsOnly: boolean,
): ProjectSelections {
    if (!versionsOnly) return projectSelections(profile.selections);
    return {
        ...current,
        serviceImages: {
            ...current.serviceImages,
            ...profile.selections.serviceImages,
        },
    };
}

export function validateEnvironmentSelections(
    selections: ProjectSelections,
    groups: ServiceGroup[],
) {
    const definitions = serviceDefinitions(groups);
    const names = [
        ...selections.services,
        ...selections.servicesWithLiveUpdate,
        ...selections.excludedServices,
        ...(selections.excludedFiles ?? []),
    ];
    for (const name of names) {
        if (!definitions[name] || definitions[name].deprecated)
            throw new Error(`Unknown service: ${name}`);
    }
    for (const name of selections.modules) {
        if (!moduleNames(groups).includes(name))
            throw new Error(`Unknown module: ${name}`);
    }
    for (const name of [
        ...selections.excludedServices,
        ...(selections.excludedFiles ?? []),
    ]) {
        if (definitions[name].base)
            throw new Error(`${name} is required infrastructure.`);
    }
    resolveServiceState(selections, groups);
}

function comparison(selections: ProjectSelections, groups: ServiceGroup[]) {
    const details = resolveServiceState(selections, groups);
    return Object.fromEntries(
        Object.entries(details).map(([name, item]) => [
            name,
            {
                enabled: item.enabled,
                provider: item.mode,
                scenario: item.mockScenario ?? item.savedMockScenario ?? '',
                image: selections.serviceImages?.[name] ?? '(default)',
                versionSource:
                    selections.serviceVersionSources?.[name] ??
                    '(environment default)',
                excluded: item.excluded ? 'Yes' : 'No',
                root: selections.services.includes(name) ? 'Yes' : 'No',
                development: selections.servicesWithLiveUpdate.includes(name)
                    ? 'Yes'
                    : 'No',
            },
        ]),
    );
}

export function profileChanges(
    current: ProjectSelections,
    next: ProjectSelections,
    groups: ServiceGroup[],
): ProfileChange[] {
    const before = comparison(current, groups);
    const after = comparison(next, groups);
    const changes: ProfileChange[] = selectionChanges(current, next);
    for (const [service, values] of Object.entries(after)) {
        for (const field of Object.keys(values) as (keyof typeof values)[]) {
            if (before[service][field] !== values[field])
                changes.push({
                    service,
                    field,
                    before: before[service][field],
                    after: values[field],
                });
        }
    }
    return changes;
}

function selectionChanges(
    current: ProjectSelections,
    next: ProjectSelections,
): ProfileChange[] {
    const changes: ProfileChange[] = [];
    if ((current.versionSource ?? 'cidev') !== (next.versionSource ?? 'cidev'))
        changes.push({
            service: '(environment)',
            field: 'version source',
            before: current.versionSource ?? 'cidev',
            after: next.versionSource ?? 'cidev',
        });
    if (
        JSON.stringify([...current.modules].sort()) !==
        JSON.stringify([...next.modules].sort())
    )
        changes.push({
            service: '(modules)',
            field: 'selection',
            before: current.modules.join(', ') || '(none)',
            after: next.modules.join(', ') || '(none)',
        });
    return changes;
}
