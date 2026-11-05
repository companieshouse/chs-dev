import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { nodeProjectFs, optionalFile, type ProjectFs } from './files.js';
import { loadDefinitions, readState, resolveSelection } from './resolve.js';
import { selectedJourney } from './journeys.js';

/** Services the usage cache demoted to lazy after an unused run. */
export interface UsagePolicy {
    learned: ReadonlySet<string>;
}

export interface UsageLastRun {
    /** When the run closed. */
    at: string;
    /** Every service in the run's selection. */
    selection: string[];
    /** Services that received proxied traffic during the run. */
    used: string[];
}

/** The persisted usage cache: learned verdicts plus the last run's evidence. */
export interface UsageRecord {
    learned: string[];
    lastRun?: UsageLastRun;
}

/** A run's selection snapshot: everything selected plus what the cache may learn about. */
export interface UsageRunSelection {
    /** Every service in the resolved selection (closure included). */
    selection: string[];
    /** Derived members the cache may demote or reclaim. */
    eligible: string[];
}

export const usageCacheFile = '.chs-dev-usage.yaml';

const header = { format: 'chs-dev-usage', version: 1 } as const;

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
        ...new Set(
            value.filter((name): name is string => typeof name === 'string'),
        ),
    ].sort();
}

function parseLastRun(value: unknown): UsageLastRun | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const run = value as Record<string, unknown>;
    if (
        typeof run.at !== 'string' ||
        Number.isNaN(Date.parse(run.at)) ||
        !Array.isArray(run.selection) ||
        !Array.isArray(run.used)
    )
        return undefined;
    return {
        at: run.at,
        selection: stringList(run.selection),
        used: stringList(run.used),
    };
}

/**
 * Leniently parses the usage cache; anything malformed reads as empty so a
 * damaged file can never break the environment.
 */
export function parseUsageCache(raw: string): UsageRecord {
    let document: unknown;
    try {
        document = parse(raw);
    } catch {
        return { learned: [] };
    }
    if (!document || typeof document !== 'object' || Array.isArray(document))
        return { learned: [] };
    const record = document as Record<string, unknown>;
    if (record.format !== header.format || record.version !== header.version)
        return { learned: [] };
    const lastRun = parseLastRun(record.lastRun);
    return {
        learned: stringList(record.learned),
        ...(lastRun ? { lastRun } : {}),
    };
}

/** Serializes the usage cache as the YAML the parser reads back. */
export function usageCacheYaml(record: UsageRecord): string {
    return stringify({
        ...header,
        learned: [...new Set(record.learned)].sort(),
        ...(record.lastRun
            ? {
                  lastRun: {
                      at: record.lastRun.at,
                      selection: [...new Set(record.lastRun.selection)].sort(),
                      used: [...new Set(record.lastRun.used)].sort(),
                  },
              }
            : {}),
    });
}

/** Reads the usage cache; a missing or malformed file reads as empty. */
export async function readUsageCache(
    directory: string,
    fs: ProjectFs = nodeProjectFs,
): Promise<UsageRecord> {
    const raw = await optionalFile(fs, join(directory, usageCacheFile));
    return raw === undefined ? { learned: [] } : parseUsageCache(raw);
}

/** Replaces the usage cache file. */
export async function writeUsageCache(
    directory: string,
    record: UsageRecord,
    fs: ProjectFs = nodeProjectFs,
): Promise<void> {
    if (!fs.replaceFile)
        throw new Error(
            'The filesystem does not support replacing the usage cache',
        );
    await fs.replaceFile(
        join(directory, usageCacheFile),
        usageCacheYaml(record),
    );
}

/** Removes the usage cache file; returns whether one existed. */
export async function clearUsageCache(
    directory: string,
    fs: ProjectFs = nodeProjectFs,
): Promise<boolean> {
    if (!fs.unlink)
        throw new Error(
            'The filesystem does not support removing the usage cache',
        );
    let removed = false;
    await fs
        .unlink(join(directory, usageCacheFile))
        .then(() => {
            removed = true;
        })
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
        });
    return removed;
}

/** Drops services from the learned set (a pin is authoritative evidence of need). */
export async function forgetUsage(
    directory: string,
    names: readonly string[],
    fs: ProjectFs = nodeProjectFs,
): Promise<UsageRecord> {
    const record = await readUsageCache(directory, fs);
    const forgotten = new Set(names);
    const next: UsageRecord = {
        learned: record.learned.filter((name) => !forgotten.has(name)),
        ...(record.lastRun ? { lastRun: record.lastRun } : {}),
    };
    if (next.learned.length !== record.learned.length)
        await writeUsageCache(directory, next, fs);
    return next;
}

/** The resolve policy for the cache, or undefined when disabled or empty. */
export async function loadUsagePolicy(
    directory: string,
    enabled: boolean | undefined,
    fs: ProjectFs = nodeProjectFs,
): Promise<UsagePolicy | undefined> {
    if (!enabled) return undefined;
    const record = await readUsageCache(directory, fs);
    if (!record.learned.length) return undefined;
    return { learned: new Set(record.learned) };
}

/**
 * Snapshots a run's selection for the usage tracker: every selected service
 * plus the derived members the cache may learn about (unpinned, unlabelled,
 * non-mock). Independent of the policy so verdicts never depend on it.
 */
export async function resolveUsageRun(
    directory: string,
    fs: ProjectFs = nodeProjectFs,
): Promise<UsageRunSelection> {
    const { definitions } = await loadDefinitions(directory, fs);
    const raw = await optionalFile(fs, join(directory, '.chs-dev.yaml'));
    const state = readState(raw ?? '{}\n');
    const journey = await selectedJourney(directory, state.journey, fs);
    const { entries } = resolveSelection(definitions, state, journey);
    return {
        selection: entries.map((entry) => entry.service),
        eligible: entries
            .filter((entry) => entry.reclaimable)
            .map((entry) => entry.service),
    };
}
