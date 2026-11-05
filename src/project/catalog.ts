import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ProjectConfig } from './config.js';
import { readMockCatalogue } from './mock-catalogue.js';

import type { ServiceDefinition, ServiceGroup } from '../domain/services.js';
export type { ServiceGroup } from '../domain/services.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const composeFilePattern = /(?:^|\.)docker-compose\.ya?ml$/;

function isModuleDirectory(recursive: boolean, file: Dirent): boolean {
    return (
        recursive &&
        file.isDirectory() &&
        !file.name.startsWith('.') &&
        file.name !== 'assets'
    );
}

const startModeLabel = 'chs.start-mode';

function parseStartMode(
    name: string,
    base: boolean,
    labels: unknown,
    listLabels: string[] | undefined,
): 'lazy' | 'always' | undefined {
    const raw = Array.isArray(listLabels)
        ? listLabels
              .find((label) => label.startsWith(`${startModeLabel}=`))
              ?.slice(startModeLabel.length + 1)
        : isRecord(labels)
          ? labels[startModeLabel]
          : undefined;
    if (raw === undefined) return undefined;
    if (base)
        throw new Error(
            `${startModeLabel} is not supported on base infrastructure: ${name}`,
        );
    if (raw !== 'lazy' && raw !== 'always')
        throw new Error(
            `Invalid ${startModeLabel} "${String(raw)}" on service ${name}: expected lazy or always`,
        );
    return raw;
}

function stringLabels(labels: unknown): {
    list: string[] | undefined;
    map: Record<string, unknown> | undefined;
} {
    if (Array.isArray(labels))
        return {
            list: labels.filter(
                (item): item is string => typeof item === 'string',
            ),
            map: undefined,
        };
    return { list: undefined, map: isRecord(labels) ? labels : undefined };
}

function parseDependencies(dependencies: unknown): string[] {
    if (Array.isArray(dependencies))
        return dependencies.filter(
            (item): item is string => typeof item === 'string',
        );
    return isRecord(dependencies) ? Object.keys(dependencies) : [];
}

function serviceDefinition(
    name: string,
    spec: unknown,
    module: string,
    base: boolean,
): ServiceDefinition {
    const definition = isRecord(spec) ? spec : {};
    const { list: listLabels, map: mapLabels } = stringLabels(
        definition.labels,
    );
    const startMode = parseStartMode(name, base, mapLabels, listLabels);
    return {
        dependencies: parseDependencies(definition.depends_on),
        module,
        base,
        deprecated: listLabels
            ? listLabels.includes('chs.deprecated=true')
            : String(mapLabels?.['chs.deprecated']) === 'true',
        ...(startMode ? { startMode } : {}),
        development: listLabels
            ? listLabels.some((label) => /^chs\.local\.builder=.+/.test(label))
            : Boolean(mapLabels?.['chs.local.builder']),
        ...(typeof definition.image === 'string'
            ? { image: definition.image }
            : {}),
    };
}

async function readComposeFile(
    directory: string,
    file: Dirent,
): Promise<{
    services: string[];
    definitions: Record<string, ServiceDefinition>;
}> {
    const path = join(directory, file.name);
    try {
        const document: unknown = parse(await readFile(path, 'utf8'));
        if (!isRecord(document)) throw new Error('Expected a YAML mapping');
        if (document.services === undefined)
            return { services: [], definitions: {} };
        if (!isRecord(document.services))
            throw new Error('Expected a services mapping');
        const services = new Set<string>();
        const definitions: Record<string, ServiceDefinition> = {};
        for (const [service, spec] of Object.entries(document.services)) {
            services.add(service);
            definitions[service] = serviceDefinition(
                service,
                spec,
                directory.split(/[\\/]/).at(-1)!,
                file.name === 'docker-compose.yaml',
            );
        }
        return { services: [...services], definitions };
    } catch (error) {
        throw new Error(
            `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

async function readGroup(
    directory: string,
    name: string,
    recursive = false,
): Promise<ServiceGroup> {
    const files = await readdir(directory, { withFileTypes: true });
    const services = new Set<string>();
    const definitions: Record<string, ServiceDefinition> = {};
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
        if (isModuleDirectory(recursive, file)) {
            const nested = await readGroup(
                join(directory, file.name),
                name,
                true,
            );
            for (const service of nested.services) services.add(service);
            Object.assign(definitions, nested.definitions);
            continue;
        }
        if (!file.isFile() || !composeFilePattern.test(file.name)) continue;
        const { services: found, definitions: foundDefinitions } =
            await readComposeFile(directory, file);
        for (const service of found) services.add(service);
        Object.assign(definitions, foundDefinitions);
    }
    return {
        name,
        services: [...services].sort((a, b) => a.localeCompare(b)),
        definitions,
    };
}

export async function readServices(
    config: ProjectConfig,
): Promise<ServiceGroup[]> {
    if (!config.valid)
        throw new Error(`Cannot read services: ${config.message}`);
    const modulesPath = join(config.directory, 'services/modules');
    const modules = await readdir(modulesPath, { withFileTypes: true });
    const groups: ServiceGroup[] = [];
    for (const module of modules.sort((a, b) => a.name.localeCompare(b.name))) {
        if (module.isDirectory())
            groups.push(
                await readGroup(join(modulesPath, module.name), module.name),
            );
    }
    groups.push(
        await readGroup(
            join(config.directory, 'services/infrastructure'),
            'Infrastructure',
            true,
        ),
    );
    const mocks = await readMockCatalogue();
    for (const group of groups) {
        for (const [name, definition] of Object.entries(
            group.definitions ?? {},
        )) {
            const contract = mocks.services[name];
            if (contract && !definition.base && !definition.deprecated)
                definition.mock = {
                    defaultScenario: contract.defaultScenario,
                    scenarios: contract.scenarios,
                };
        }
    }
    return groups;
}
