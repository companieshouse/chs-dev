import { join } from 'node:path';
import type {
    JourneyMeasurement,
    SelectionMeasurement,
    StackMeasurement,
} from '../domain/measurements.js';
import { measureJourneyDelta } from '../domain/measurements.js';
import { nodeProjectFs, type ProjectFs } from './files.js';
import type { Mapping } from './compose.js';
import {
    loadDefinitions,
    readState,
    resolveSelection,
    type Definitions,
    type ProjectState,
} from './resolve.js';
import type { UsagePolicy } from './usage-cache.js';
import { loadUsagePolicy } from './usage-cache.js';
import { loadJourney, selectedJourney, type Journey } from './journeys.js';

export function parseMemoryValue(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number') return value;
    const m = /^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i.exec(String(value));
    if (!m) throw new Error(`Unsupported memory value ${value}`);
    return Math.round(
        Number(m[1]) *
            1024 ** Math.max(0, 'bkmg'.indexOf((m[2] ?? 'b').toLowerCase())),
    );
}

const memoryFields = ['mem_limit', 'mem_reservation'] as const;

interface MemoryTotals {
    memoryLimitBytes: number;
    memoryReservationBytes: number;
    servicesWithMemoryLimit: number;
    servicesWithoutMemoryLimit: string[];
    unparsedMemory: SelectionMeasurement['unparsedMemory'];
}

function addMemoryValue(
    totals: MemoryTotals,
    name: string,
    field: (typeof memoryFields)[number],
    raw: unknown,
): void {
    try {
        const bytes = parseMemoryValue(raw) ?? 0;
        if (field === 'mem_limit') totals.memoryLimitBytes += bytes;
        else totals.memoryReservationBytes += bytes;
    } catch {
        totals.unparsedMemory.push({ service: name, field, value: raw });
    }
}

function addServiceMemory(
    totals: MemoryTotals,
    name: string,
    spec: Mapping,
): void {
    let declared = false;
    for (const field of memoryFields) {
        const raw = spec[field];
        if (raw === undefined) continue;
        declared = true;
        addMemoryValue(totals, name, field, raw);
    }
    if (declared) totals.servicesWithMemoryLimit++;
    else totals.servicesWithoutMemoryLimit.push(name);
}

function countSelectedEdges(
    dependencies: ReadonlyMap<string, readonly string[]>,
    selected: ReadonlySet<string>,
): number {
    let edges = 0;
    for (const [name, targets] of dependencies) {
        if (!selected.has(name)) continue;
        for (const target of targets) if (selected.has(target)) edges++;
    }
    return edges;
}

export function measureSelection(
    definitions: Definitions,
    state: ProjectState,
    journey?: Journey,
    usage?: UsagePolicy,
): SelectionMeasurement {
    const { dependencies, entries } = resolveSelection(
        definitions,
        state,
        journey,
        usage,
    );
    const selected = entries.map((entry) => entry.service);
    const selectedSet = new Set(selected);
    const baseServices = selected.filter((name) => definitions.get(name)?.base);
    const modeCounts: Record<string, number> = {};
    for (const entry of entries)
        modeCounts[entry.mode] = (modeCounts[entry.mode] ?? 0) + 1;

    const totals: MemoryTotals = {
        memoryLimitBytes: 0,
        memoryReservationBytes: 0,
        servicesWithMemoryLimit: 0,
        servicesWithoutMemoryLimit: [],
        unparsedMemory: [],
    };
    for (const name of selected)
        addServiceMemory(totals, name, definitions.get(name)!.spec);

    return {
        services: [...selected].sort(),
        baseServices: [...baseServices].sort(),
        serviceCount: selected.length,
        baseServiceCount: baseServices.length,
        modeCounts,
        dependencyEdgeCount: countSelectedEdges(dependencies, selectedSet),
        memoryLimitBytes: totals.memoryLimitBytes,
        memoryReservationBytes: totals.memoryReservationBytes,
        servicesWithMemoryLimit: totals.servicesWithMemoryLimit,
        servicesWithoutMemoryLimit: totals.servicesWithoutMemoryLimit,
        unparsedMemory: totals.unparsedMemory,
        lazyServices: entries
            .filter((entry) => entry.lazy)
            .map((entry) => entry.service),
    };
}

/**
 * Measures a journey as the target selection: the journey's members and their
 * closure instead of the enabled services, with the rest of the state
 * (providers, exclusions, modules) preserved. Lazy members stay in the set.
 */
function measureJourneyTarget(
    baseline: SelectionMeasurement,
    state: ProjectState,
    journey: Journey,
    definitions: Definitions,
    usage?: UsagePolicy,
): JourneyMeasurement {
    const target = measureSelection(
        definitions,
        { ...state, services: [], journey: undefined },
        journey,
        usage,
    );
    const targetSet = new Set(target.services);
    const baselineSet = new Set(baseline.services);
    const lazySet = new Set(target.lazyServices);
    return {
        name: journey.name,
        started: target.services.filter((name) => !lazySet.has(name)).sort(),
        lazy: target.lazyServices.slice().sort(),
        notInJourney: baseline.services.filter((name) => !targetSet.has(name)),
        added: target.services.filter((name) => !baselineSet.has(name)),
        target,
        delta: measureJourneyDelta(baseline, target),
    };
}

/**
 * Measures the stack the preparation path would start: definitions come from
 * the Compose sources and selections from the checkout's `.chs-dev.yaml`.
 * With a journey name, also measures the journey as the target selection and
 * reports the delta against the current selection.
 */
export async function measureProject(
    directory: string,
    fs: ProjectFs = nodeProjectFs,
    journeyName?: string,
    usageCache?: boolean,
): Promise<StackMeasurement> {
    const { definitions } = await loadDefinitions(directory, fs);
    const raw = await fs
        .readFile(join(directory, '.chs-dev.yaml'))
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return '{}\n';
            throw error;
        });
    const state = readState(raw);
    const usage = await loadUsagePolicy(directory, usageCache, fs);
    const baseline = measureSelection(
        definitions,
        state,
        await selectedJourney(directory, state.journey, fs),
        usage,
    );
    if (!journeyName) return { baseline };
    const journey = await loadJourney(directory, journeyName, fs);
    return {
        baseline,
        journey: measureJourneyTarget(
            baseline,
            state,
            journey,
            definitions,
            usage,
        ),
    };
}
