import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MockSupport } from '../domain/providers.js';
import { mapping, ProjectError } from './compose.js';

export const mocksDirectory = fileURLToPath(
    new URL('../../mocks/', import.meta.url),
);
export interface MockContract extends MockSupport {
    title: string;
    version: string;
    artifact: string;
    ports: number[];
    healthPaths: string[];
    asyncCallback?: {
        requestPath: string;
        urlFields: string[];
        resultPath: string;
        method: 'PATCH' | 'POST';
    };
}
export interface MockCatalogue {
    image: string;
    services: Record<string, MockContract>;
}

function validContract(value: unknown): value is MockContract {
    if (!mapping(value)) return false;
    return (
        ['title', 'version', 'artifact'].every(
            (key) => typeof value[key] === 'string' && value[key].length > 0,
        ) &&
        typeof value.defaultScenario === 'string' &&
        Array.isArray(value.scenarios) &&
        value.scenarios.length > 0 &&
        validScenarios(value.scenarios, value.defaultScenario) &&
        validPorts(value.ports) &&
        validCallback(value.asyncCallback) &&
        Array.isArray(value.healthPaths) &&
        value.healthPaths.every(
            (path: unknown) => typeof path === 'string' && path.startsWith('/'),
        )
    );
}

function validCallback(value: unknown): boolean {
    if (value === undefined) return true;
    if (!mapping(value)) return false;
    return (
        ['requestPath', 'resultPath'].every(
            (key) =>
                typeof value[key] === 'string' && /^\/(?!\/)/.test(value[key]),
        ) &&
        ['PATCH', 'POST'].includes(String(value.method)) &&
        Array.isArray(value.urlFields) &&
        value.urlFields.length > 0 &&
        value.urlFields.every(
            (field: unknown) =>
                typeof field === 'string' && /^[a-zA-Z_]+$/.test(field),
        )
    );
}

function validPorts(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every(
            (port) => Number.isInteger(port) && port > 0 && port < 65536,
        )
    );
}

function validScenarios(
    scenarios: unknown[],
    defaultScenario: string,
): boolean {
    const names = new Set<string>();
    for (const scenario of scenarios) {
        if (
            !mapping(scenario) ||
            typeof scenario.name !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(scenario.name) ||
            typeof scenario.description !== 'string' ||
            names.has(scenario.name)
        )
            return false;
        names.add(scenario.name);
    }
    return names.has(defaultScenario);
}

export async function mockArtifactPath(
    artifact: string,
    root = mocksDirectory,
): Promise<string> {
    const base = await realpath(root);
    const path = await realpath(resolve(base, artifact));
    const local = relative(base, path);
    if (local === '..' || local.startsWith('../') || isAbsolute(local))
        throw new ProjectError(
            'Mock artifacts must stay inside the mocks directory.',
        );
    return path;
}

export async function readMockCatalogue(
    root = mocksDirectory,
): Promise<MockCatalogue> {
    const document: unknown = JSON.parse(
        await readFile(resolve(root, 'catalogue.json'), 'utf8'),
    );
    if (
        !mapping(document) ||
        document.version !== 1 ||
        typeof document.image !== 'string' ||
        !mapping(document.services)
    )
        throw new ProjectError('Invalid mocks/catalogue.json.');
    for (const [name, contract] of Object.entries(document.services)) {
        if (
            !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) ||
            !validContract(contract)
        )
            throw new ProjectError(`Invalid mock contract for ${name}.`);
        await mockArtifactPath(contract.artifact, root);
    }
    return { image: document.image, services: document.services };
}
