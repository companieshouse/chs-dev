import { basename, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { InventoryEntry, SshSecretRequirement } from '../domain/live.js';
import { withMockRuntime } from '../domain/live.js';
import {
    providerSelections,
    selectedProvider,
    validateProvider,
    type ProviderSelections,
    type MockSupport,
} from '../domain/providers.js';
import { serviceMode } from '../domain/services.js';
import { readMockCatalogue } from './mock-catalogue.js';
import { labels, mapping, ProjectError, type Mapping } from './compose.js';
import type { ProjectEntry, ProjectFs } from './files.js';

export interface ServiceDefinition {
    spec: Mapping;
    source: string;
    module: string;
    base: boolean;
    labels: Record<string, unknown>;
    mock?: MockSupport;
}
export type Definitions = Map<string, ServiceDefinition>;
export type Resources = Record<
    'networks' | 'volumes' | 'secrets' | 'configs',
    Mapping
>;
export interface ProjectState extends ProviderSelections {
    modules: string[];
    services: string[];
    servicesWithLiveUpdate: string[];
    excludedServices: string[];
    excludedFiles: string[];
}

const stateKeys = [
    'modules',
    'services',
    'servicesWithLiveUpdate',
    'excludedServices',
    'excludedFiles',
] as const;

export function readState(raw: string): ProjectState {
    const value: unknown = parse(raw);
    if (!mapping(value))
        throw new ProjectError('Configuration must be a YAML mapping');
    const state = {} as ProjectState;
    for (const key of stateKeys) {
        const entries: unknown = value[key] ?? [];
        if (
            !Array.isArray(entries) ||
            entries.some((entry) => typeof entry !== 'string')
        ) {
            throw new ProjectError(`Configuration has invalid ${key}`);
        }
        state[key] = [...new Set(entries as string[])];
    }
    return { ...state, ...providerSelections(value) };
}

export function dependencyClosure(
    dependencies: ReadonlyMap<string, readonly string[]>,
    roots: readonly string[],
    excluded: ReadonlySet<string> = new Set(),
) {
    const selected = new Set<string>();
    const visit = (name: string) => {
        if (selected.has(name) || excluded.has(name)) return;
        const next = dependencies.get(name);
        if (!next)
            throw new ProjectError(
                `Required service dependency ${name} is missing`,
            );
        selected.add(name);
        next.forEach(visit);
    };
    roots.forEach(visit);
    return [...selected];
}

function validateConfiguredServices(
    definitions: Definitions,
    state: ProjectState,
) {
    validateConfiguredProviders(definitions, state);
    for (const name of [...state.services, ...state.servicesWithLiveUpdate]) {
        if (!definitions.has(name))
            throw new ProjectError(
                `Configuration references an unknown service: ${name}`,
            );
    }
    for (const module of state.modules) {
        if (![...definitions.values()].some((item) => item.module === module))
            throw new ProjectError(
                `Configuration references an unknown module: ${module}`,
            );
    }
}

function validateConfiguredProviders(
    definitions: Definitions,
    state: ProjectState,
): void {
    const names = new Set([
        ...Object.keys(state.serviceProviders ?? {}),
        ...Object.keys(state.mockScenarios ?? {}),
    ]);
    for (const name of names) {
        const definition = definitions.get(name);
        if (!definition || definition.labels['chs.deprecated'] === 'true')
            throw new ProjectError(
                `Configuration references an unknown service: ${name}`,
            );
        const support = {
            base: definition.base,
            development: Boolean(definition.labels['chs.local.builder']),
            mock: definition.mock,
        };
        validateProvider(
            name,
            selectedProvider(name, state),
            support,
            state.mockScenarios?.[name],
        );
        if (state.mockScenarios?.[name])
            validateProvider(name, 'mock', support, state.mockScenarios[name]);
    }
}

export function resolveServices(
    definitions: Definitions,
    state: ProjectState,
): InventoryEntry[] {
    const excluded = new Set([
        ...state.excludedServices,
        ...state.excludedFiles,
    ]);
    validateConfiguredServices(definitions, state);
    const roots: string[] = [];
    for (const [name, definition] of definitions) {
        if (definition.base && excluded.has(name))
            throw new ProjectError(
                `Base infrastructure cannot be excluded: ${name}`,
            );
        if (definition.labels['chs.deprecated'] === 'true') excluded.add(name);
        if (
            definition.base ||
            state.services.includes(name) ||
            state.modules.includes(definition.module)
        )
            roots.push(name);
    }
    const dependencies = new Map(
        [...definitions].map(([name, definition]) => [
            name,
            selectedProvider(name, state) === 'mock'
                ? []
                : Array.isArray(definition.spec.depends_on)
                  ? (definition.spec.depends_on as string[])
                  : Object.keys(definition.spec.depends_on ?? {}),
        ]),
    );
    return withMockRuntime(
        dependencyClosure(dependencies, roots, excluded)
            .sort()
            .map((service) => ({
                service,
                mode: serviceMode(
                    service,
                    state.servicesWithLiveUpdate.includes(service),
                    state.serviceProviders?.[service],
                ) as InventoryEntry['mode'],
                ...(selectedProvider(service, state) === 'mock'
                    ? {
                          mockScenario:
                              state.mockScenarios?.[service] ??
                              definitions.get(service)!.mock!.defaultScenario,
                      }
                    : {}),
            })),
    );
}

export function resolveSshRequirements(
    definitions: Definitions,
    inventory: readonly InventoryEntry[],
): SshSecretRequirement[] {
    const services = inventory
        .filter(
            (entry) =>
                entry.mode === 'Development' &&
                definitions.get(entry.service)?.labels[
                    'chs.local.builder.requiresSecrets'
                ] === 'true',
        )
        .map((entry) => entry.service)
        .sort();
    if (!services.length) return [];
    return [
        {
            kind: 'container-ssh-secrets',
            services,
            keyPath: 'local/.ssh_key',
            passphrasePath: 'local/.ssh_key_passphrase',
        },
    ];
}

/**
 * Reads `services/modules/<module>/*docker-compose.yaml` and every Compose file under
 * `services/infrastructure`. A file named exactly `docker-compose.yaml` holds base services.
 */
const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

function isTraversable(recursive: boolean, entry: ProjectEntry): boolean {
    return (
        entry.isDirectory() &&
        recursive &&
        !entry.name.startsWith('.') &&
        entry.name !== 'assets'
    );
}

function requireServiceDocument(
    document: unknown,
    relativeSource: string,
): Mapping {
    if (!mapping(document) || !mapping(document.services))
        throw new ProjectError(
            `Invalid service Compose definition: ${relativeSource}`,
        );
    return document;
}

function requireValidService(
    definitions: Definitions,
    name: string,
    spec: unknown,
    relativeSource: string,
): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) || !mapping(spec)) {
        throw new ProjectError(
            `Invalid service definition ${name} in ${relativeSource}`,
        );
    }
    if (definitions.has(name))
        throw new ProjectError(
            `Duplicate service definition ${name} in ${relativeSource}`,
        );
}

function mergeResources(
    resources: Resources,
    key: keyof Resources,
    declared: Mapping,
    project: string,
    relativeSource: string,
): void {
    for (const [name, spec] of Object.entries(declared)) {
        const normalized = structuredClone(spec);
        if (
            (key === 'secrets' || key === 'configs') &&
            mapping(normalized) &&
            typeof normalized.file === 'string'
        ) {
            normalized.file = resolve(project, normalized.file);
        }
        if (
            name in resources[key] &&
            stringify(resources[key][name]) !== stringify(normalized)
        ) {
            throw new ProjectError(
                `Conflicting Compose ${key} definition ${name} in ${relativeSource}`,
            );
        }
        resources[key][name] = normalized;
    }
}

function mergeDeclaredResources(
    resources: Resources,
    document: Mapping,
    project: string,
    relativeSource: string,
) {
    for (const key of Object.keys(resources) as (keyof Resources)[]) {
        const declared: unknown = document[key] ?? {};
        if (!mapping(declared)) continue;
        mergeResources(resources, key, declared, project, relativeSource);
    }
}

export async function loadDefinitions(project: string, fs: ProjectFs) {
    const definitions: Definitions = new Map();
    const resources: Resources = {
        networks: {},
        volumes: {},
        secrets: {},
        configs: {},
    };
    const walk = async (directory: string, recursive: boolean) => {
        const entries = await fs.readdir(directory);
        for (const entry of entries.sort(byName)) {
            if (isTraversable(recursive, entry))
                await walk(join(directory, entry.name), true);
            if (
                !entry.isFile() ||
                !/(?:^|\.)docker-compose\.ya?ml$/.test(entry.name)
            )
                continue;
            const source = join(directory, entry.name);
            const relativeSource = source.slice(project.length + 1);
            const document = requireServiceDocument(
                parse(await fs.readFile(source)),
                relativeSource,
            );
            if (document.include || document.extends)
                throw new ProjectError(
                    `Nested Compose imports are not supported: ${relativeSource}`,
                );
            for (const [name, spec] of Object.entries(
                document.services as Mapping,
            )) {
                requireValidService(definitions, name, spec, relativeSource);
                definitions.set(name, {
                    spec,
                    source,
                    module: basename(directory),
                    base: entry.name === 'docker-compose.yaml',
                    labels: labels(spec.labels),
                });
            }
            mergeDeclaredResources(
                resources,
                document,
                project,
                relativeSource,
            );
        }
    };
    const modules = await fs.readdir(join(project, 'services/modules'));
    for (const module of modules.sort(byName)) {
        if (module.isDirectory())
            await walk(join(project, 'services/modules', module.name), false);
    }
    await walk(join(project, 'services/infrastructure'), true);
    if (definitions.has('chs-dev-microcks'))
        throw new ProjectError(
            'chs-dev-microcks is reserved for the mock runtime.',
        );
    const mocks = await readMockCatalogue();
    for (const [name, definition] of definitions) {
        if (mocks.services[name]) definition.mock = mocks.services[name];
    }
    return { definitions, resources };
}
