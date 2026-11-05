import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ProjectConfig } from './config.js';

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

function serviceDefinition(
    spec: unknown,
    module: string,
    base: boolean,
): ServiceDefinition {
    const definition = isRecord(spec) ? spec : {};
    const dependencies = definition.depends_on;
    const labels = definition.labels;
    return {
        dependencies: Array.isArray(dependencies)
            ? dependencies.filter(
                  (item): item is string => typeof item === 'string',
              )
            : isRecord(dependencies)
              ? Object.keys(dependencies)
              : [],
        module,
        base,
        deprecated: Array.isArray(labels)
            ? labels.includes('chs.deprecated=true')
            : isRecord(labels) && String(labels['chs.deprecated']) === 'true',
        development: Array.isArray(labels)
            ? labels.some(
                  (label) =>
                      typeof label === 'string' &&
                      /^chs\.local\.builder=.+/.test(label),
              )
            : isRecord(labels) && Boolean(labels['chs.local.builder']),
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
    return groups;
}
