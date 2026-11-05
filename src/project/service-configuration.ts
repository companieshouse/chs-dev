import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { resolveServiceState } from '../domain/service-state.js';
import type { ServiceGroup } from './catalog.js';
import { serviceDependencies } from '../domain/service-dependencies.js';
import { tuiLog } from '../infrastructure/tui-log.js';

export interface SaveServiceChangesOptions {
    directory: string;
    name: string;
    enabled: boolean;
    development: boolean;
    groups: ServiceGroup[];
    exclusions?: Record<string, boolean>;
    expectedRevision?: string;
}

function validateSaveRequest(
    name: string,
    enabled: boolean,
    development: boolean,
    groups: ServiceGroup[],
    exclusions: Record<string, boolean>,
): void {
    const definition = groups.find((group) => group.services.includes(name))
        ?.definitions?.[name];
    if (!definition || definition.deprecated)
        throw new Error('This service cannot be configured.');
    if (definition.base && !enabled)
        throw new Error('Base infrastructure must remain enabled.');
    if (development && !definition.development)
        throw new Error('This service does not support development mode.');
    validateExclusions(name, groups, exclusions);
}

function validateExclusions(
    name: string,
    groups: ServiceGroup[],
    exclusions: Record<string, boolean>,
) {
    const dependencies = serviceDependencies(name, groups);
    for (const [dependency, excluded] of Object.entries(exclusions)) {
        const option = dependencies.find((item) => item.name === dependency);
        if (!option)
            throw new Error(`${dependency} is not a dependency of ${name}.`);
        if (option.required && excluded)
            throw new Error(`${dependency} is required infrastructure.`);
    }
}

function logValidated(
    name: string,
    enabled: boolean,
    development: boolean,
    exclusions: Record<string, boolean>,
): void {
    tuiLog?.write('config.save', {
        status: 'validated',
        service: name,
        enabled,
        development,
        count: 1 + Object.keys(exclusions).length,
    });
    for (const [dependency, excluded] of Object.entries(exclusions))
        tuiLog?.write('config.save', {
            status: 'validated',
            service: dependency,
            enabled: !excluded,
        });
}

export function requireRevision(
    original: string | null,
    expectedRevision?: string,
): void {
    if (
        expectedRevision &&
        createHash('sha256')
            .update(original ?? '{}\n')
            .digest('hex') !== expectedRevision
    )
        throw new Error(
            'Configuration changed since this editor opened. Close it and review the latest values.',
        );
}

export function loadDocument(original: string | null): Document {
    const document =
        original === null
            ? new Document({
                  modules: [],
                  services: [],
                  servicesWithLiveUpdate: [],
                  excludedServices: [],
              })
            : parseDocument(original);
    if (document.errors.length)
        throw new Error('Cannot edit invalid .chs-dev.yaml');
    return document;
}

function applyChanges(
    document: Document,
    name: string,
    enabled: boolean,
    development: boolean,
    exclusions: Record<string, boolean>,
): void {
    const update = (key: string, include: boolean, serviceName = name) => {
        const values: unknown = document.toJS()[key] ?? [];
        if (
            !Array.isArray(values) ||
            values.some((value) => typeof value !== 'string')
        )
            throw new Error(`Invalid ${key} in .chs-dev.yaml`);
        const next = values.filter((value) => value !== serviceName);
        if (include) next.push(serviceName);
        document.set(key, next);
    };
    update('services', enabled);
    update('excludedServices', !enabled);
    update('servicesWithLiveUpdate', development);
    for (const [dependency, excluded] of Object.entries(exclusions))
        update('excludedServices', excluded, dependency);
}

export async function writeAtomically(
    path: string,
    read: () => Promise<string | null>,
    original: string | null,
    document: Document,
): Promise<void> {
    const temporary = join(dirname(path), `.chs-dev.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, document.toString(), {
            flag: 'wx',
            mode: 0o600,
        });
        if ((await read()) !== original) {
            tuiLog?.write('config.save', { status: 'conflict' });
            throw new Error(
                'Configuration changed while saving. Try applying again.',
            );
        }
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
}

export async function saveServiceChanges({
    directory,
    name,
    enabled,
    development,
    groups,
    exclusions = {},
    expectedRevision,
}: SaveServiceChangesOptions) {
    validateSaveRequest(name, enabled, development, groups, exclusions);
    const path = join(directory, '.chs-dev.yaml');
    logValidated(name, enabled, development, exclusions);
    const read = () =>
        readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
    const original = await read();
    requireRevision(original, expectedRevision);
    const document = loadDocument(original);
    resolveServiceState(document.toJS(), groups);
    applyChanges(document, name, enabled, development, exclusions);
    await writeAtomically(path, read, original, document);
    return resolveServiceState(document.toJS(), groups);
}
