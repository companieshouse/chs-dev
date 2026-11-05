import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { ProjectError, mapping, type Mapping } from './compose.js';
import { nodeProjectFs, type ProjectFs } from './files.js';

/** A named journey file: the services to always start plus the lazy ones. */
export interface Journey {
    name: string;
    services: string[];
    lazy: string[];
    /** Services subtracted from the journey's dependency closure. */
    excluded: string[];
}

/** The content of a journey to save; the name picks the file. */
export interface JourneyInput {
    name: string;
    services: string[];
    lazy: string[];
    excluded?: string[];
}

const journeyKeys = ['services', 'lazy', 'excluded'] as const;

const journeyName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function journeyFile(name: string): string {
    return `journeys/${name}.yaml`;
}

function stringList(name: string, key: string, value: unknown): string[] {
    if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'string')
    ) {
        throw new ProjectError(
            `Journey file ${journeyFile(name)} has invalid ${key}: expected a list of service names`,
        );
    }
    return [...new Set(value as string[])];
}

function requireJourneyMapping(name: string, document: unknown): Mapping {
    if (!mapping(document)) {
        throw new ProjectError(
            `Journey file ${journeyFile(name)} must be a mapping with services and lazy lists`,
        );
    }
    for (const key of Object.keys(document)) {
        if (!(journeyKeys as readonly string[]).includes(key)) {
            throw new ProjectError(
                `Journey file ${journeyFile(name)} has unknown key: ${key}`,
            );
        }
    }
    return document;
}

function rejectSharedName(
    name: string,
    first: { key: string; services: string[] },
    second: { key: string; services: string[] },
): void {
    for (const service of first.services) {
        if (second.services.includes(service)) {
            throw new ProjectError(
                `Journey file ${journeyFile(name)} lists ${service} in both ${first.key} and ${second.key}`,
            );
        }
    }
}

function rejectOverlap(
    name: string,
    lists: Array<{ key: string; services: string[] }>,
): void {
    for (let i = 0; i < lists.length; i++)
        for (let j = i + 1; j < lists.length; j++)
            rejectSharedName(name, lists[i]!, lists[j]!);
}

function parseJourney(name: string, raw: string): Journey {
    let document: unknown;
    try {
        document = parse(raw);
    } catch (error) {
        throw new ProjectError(
            `Journey file ${journeyFile(name)} is not valid YAML: ${
                (error as Error).message
            }`,
        );
    }
    const valid = requireJourneyMapping(name, document);
    const services = stringList(name, 'services', valid.services ?? []);
    const lazy = stringList(name, 'lazy', valid.lazy ?? []);
    const excluded = stringList(name, 'excluded', valid.excluded ?? []);
    rejectOverlap(name, [
        { key: 'services', services },
        { key: 'lazy', services: lazy },
        { key: 'excluded', services: excluded },
    ]);
    if (!services.length && !lazy.length) {
        throw new ProjectError(
            `Journey file ${journeyFile(name)} selects no services`,
        );
    }
    return { name, services, lazy, excluded };
}

/** Reads and validates `journeys/<name>.yaml` from the project checkout. */
export async function loadJourney(
    directory: string,
    name: string,
    fs: ProjectFs,
): Promise<Journey> {
    if (!journeyName.test(name)) {
        throw new ProjectError(`Invalid journey name: ${name}`);
    }
    const raw = await fs
        .readFile(join(directory, 'journeys', `${name}.yaml`))
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                throw new ProjectError(
                    `Journey file ${journeyFile(name)} does not exist`,
                );
            }
            throw error;
        });
    return parseJourney(name, raw);
}

/** Loads the journey selected in `.chs-dev.yaml`, if any. */
export async function selectedJourney(
    directory: string,
    name: string | undefined,
    fs: ProjectFs,
): Promise<Journey | undefined> {
    if (!name) return undefined;
    return loadJourney(directory, name, fs);
}

/** A journey available in the checkout, with its full member lists. */
export interface JourneySummary {
    name: string;
    services: string[];
    lazy: string[];
    excluded: string[];
}

/** A journeys directory file that is not a valid journey. */
export interface InvalidJourney {
    file: string;
    error: string;
}

/**
 * Summarises every `journeys/*.yaml` file: valid journeys with their sizes,
    plus anything that fails to parse so the CLI can say why.
 */
export async function listJourneys(
    directory: string,
    fs: ProjectFs = nodeProjectFs,
): Promise<{ journeys: JourneySummary[]; invalid: InvalidJourney[] }> {
    const entries = await fs
        .readdir(join(directory, 'journeys'))
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
    const journeys: JourneySummary[] = [];
    const invalid: InvalidJourney[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
        const name = entry.name.replace(/\.ya?ml$/, '');
        try {
            const journey = await loadJourney(directory, name, fs);
            journeys.push({
                name: journey.name,
                services: journey.services,
                lazy: journey.lazy,
                excluded: journey.excluded,
            });
        } catch (error) {
            invalid.push({
                file: journeyFile(name),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return {
        journeys: journeys.sort((a, b) => a.name.localeCompare(b.name)),
        invalid,
    };
}

/**
 * Deletes `journeys/<name>.yaml`; when it is the currently selected journey,
 * the selection is cleared in the same operation so no dangling reference
 * can remain. Returns whether a file was removed and whether the saved
 * selection was cleared.
 */
export async function deleteJourney(
    directory: string,
    name: string,
    fs: ProjectFs = nodeProjectFs,
): Promise<{ deleted: boolean; selectionCleared: boolean }> {
    if (!journeyName.test(name)) {
        throw new ProjectError(`Invalid journey name: ${name}`);
    }
    if (!fs.unlink) {
        throw new ProjectError(
            'The filesystem does not support removing journey files',
        );
    }
    const path = join(directory, 'journeys', `${name}.yaml`);
    let deleted = false;
    await fs
        .unlink(path)
        .then(() => {
            deleted = true;
        })
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
        });
    let selectionCleared = false;
    const configPath = join(directory, '.chs-dev.yaml');
    const raw = await fs.readFile(configPath).catch(() => null);
    if (raw !== null) {
        const document: Mapping = parse(raw) ?? {};
        if (mapping(document) && document.journey === name) {
            delete document.journey;
            if (fs.replaceFile)
                await fs.replaceFile(configPath, stringify(document));
            selectionCleared = true;
        }
    }
    return { deleted, selectionCleared };
}

/** Serializes journey content as the YAML the loader reads back. */
export function journeyYaml(
    services: string[],
    lazy: string[],
    excluded: string[] = [],
): string {
    if (!services.length && !lazy.length) {
        throw new ProjectError(
            'A journey needs at least one service in services or lazy',
        );
    }
    const body: Record<string, string[]> = {};
    if (services.length) body.services = [...new Set(services)].sort();
    if (lazy.length) body.lazy = [...new Set(lazy)].sort();
    if (excluded.length) body.excluded = [...new Set(excluded)].sort();
    return stringify(body);
}

/**
 * Validates and writes `journeys/<name>.yaml`, replacing any existing file.
 * Returns the written path.
 */
export async function saveJourney(
    directory: string,
    input: JourneyInput,
    fs: ProjectFs = nodeProjectFs,
): Promise<string> {
    if (!journeyName.test(input.name)) {
        throw new ProjectError(`Invalid journey name: ${input.name}`);
    }
    const excluded = input.excluded ?? [];
    rejectOverlap(input.name, [
        { key: 'services', services: input.services },
        { key: 'lazy', services: input.lazy },
        { key: 'excluded', services: excluded },
    ]);
    const text = journeyYaml(input.services, input.lazy, excluded);
    const path = join(directory, 'journeys', `${input.name}.yaml`);
    await fs.mkdir(join(directory, 'journeys'), {
        recursive: true,
        mode: 0o755,
    });
    if (!fs.replaceFile) {
        throw new ProjectError(
            'The filesystem does not support replacing journey files',
        );
    }
    await fs.replaceFile(path, text);
    return path;
}
