import {
    clearUsageCache,
    forgetUsage,
    readUsageCache,
    resolveUsageRun,
    writeUsageCache,
    type UsageRecord,
} from '../project/usage-cache.js';
import type { UsageLedger } from '../proxy/usage-ledger.js';
import type { SettingsSnapshot } from '../domain/settings.js';
import { nodeProjectFs, type ProjectFs } from '../project/files.js';

/** Minimum real requests a closed run needs before its verdict teaches. */
const MIN_RUN_REQUESTS = 5;

/** What the daemon reports about the usage cache for TUI display. */
export interface UsageSnapshot {
    /** Whether the usageCache setting enables the mechanism. */
    enabled: boolean;
    /** Services currently demoted to lazy by the cache, sorted. */
    learned: string[];
    /** Last run's selected services that received no traffic, sorted. */
    unusedLastRun: string[];
}

export interface UsageTrackerOptions {
    settings(): SettingsSnapshot;
    ledger: UsageLedger;
    fs?: ProjectFs;
    now?(): Date;
    /** Test override for the minimum requests a run needs to teach. */
    minRunRequests?: number;
}

interface OpenRun {
    directory: string;
    selection: readonly string[];
    eligible: readonly string[];
}

/**
 * Records usage-cache runs for the daemon (always, whatever the setting;
 * the setting only decides whether the learned set is applied): a run opens whenever a selection
 * becomes current (attach, apply) and closes at the next apply, environment
 * stop, checkout switch or daemon shutdown, at which point services that saw
 * no traffic are demoted to lazy for the next run.
 */
export class UsageTracker {
    private run?: OpenRun;
    private readonly fs: ProjectFs;

    constructor(private readonly options: UsageTrackerOptions) {
        this.fs = options.fs ?? nodeProjectFs;
    }

    get enabled() {
        return this.options.settings().resolved.usageCache.value;
    }

    get open() {
        return this.run !== undefined;
    }

    /** Starts a run: snapshots the selection and resets the evidence. */
    async openRun(directory: string): Promise<void> {
        const selection = await resolveUsageRun(directory, this.fs);
        this.run = { directory, ...selection };
        this.options.ledger.reset();
    }

    /**
     * Closes the run and learns from it: with enough traffic, eligible
     * services that saw none are demoted and used ones are promoted (the
     * verdict is rewritten wholesale). Runs below the traffic floor teach
     * nothing, so quick successive applies and an unbound proxy never
     * demote anything.
     */
    async closeRun(): Promise<void> {
        const run = this.run;
        this.run = undefined;
        const ledger = this.options.ledger;
        const evidence = ledger.evidence();
        ledger.reset();
        if (!run) return;
        if (evidence.total < (this.options.minRunRequests ?? MIN_RUN_REQUESTS))
            return;
        const used = new Set(evidence.used);
        await writeUsageCache(
            run.directory,
            {
                learned: run.eligible.filter((service) => !used.has(service)),
                lastRun: {
                    at: (this.options.now?.() ?? new Date()).toISOString(),
                    selection: [...run.selection],
                    used: evidence.used,
                },
            },
            this.fs,
        );
    }

    /** Drops services from the learned set; a pin outranks the cache. */
    async forget(directory: string, names: readonly string[]): Promise<void> {
        await forgetUsage(directory, names, this.fs);
    }

    /** Removes the cache file; returns whether one existed. */
    async clear(directory: string): Promise<boolean> {
        return clearUsageCache(directory, this.fs);
    }

    /** The current cache state for display. */
    async snapshot(directory: string): Promise<UsageSnapshot> {
        const record: UsageRecord = await readUsageCache(directory, this.fs);
        return {
            enabled: this.enabled,
            learned: record.learned,
            unusedLastRun: record.lastRun
                ? record.lastRun.selection.filter(
                      (service) => !record.lastRun!.used.includes(service),
                  )
                : [],
        };
    }
}
