import type { ServiceDetails } from './services.js';
import type {
    OperationContext,
    OperationResult,
    RuntimeAvailability,
} from './runtime-strategy.js';

export type ServiceMode = Exclude<ServiceDetails['mode'], 'Unknown'>;
export interface InventoryEntry {
    service: string;
    mode: ServiceMode;
    mockScenario?: string;
    /** Set for lazy services: resolved into the stack but not started eagerly. */
    lazy?: boolean;
    /** Set when the usage cache, not a label or selection, made this lazy. */
    lazySource?: 'learned';
    /** What made this service lazy: override, journey, label, inheritance or cache. */
    startModeSource?:
        'override' | 'journey' | 'label' | 'inherited' | 'learned';
    /**
     * True for derived members the usage cache may reclaim when idle and
     * learn about: unpinned, unlabelled, real (non-mock) services.
     */
    reclaimable?: boolean;
}

/** Effective lifecycle policy written into each immutable prepared container. */
export const lifecycleLabel = 'chs.dev.lifecycle';

export interface AppliedServicePolicy {
    version: 1;
    lazy: boolean;
    reclaimable: boolean;
    dependencies: string[];
}

export function appliedServicePolicy(
    raw: unknown,
    service: string,
): AppliedServicePolicy {
    let value: Partial<AppliedServicePolicy> | undefined;
    try {
        value = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    } catch {
        value = undefined;
    }
    if (
        value?.version !== 1 ||
        typeof value.lazy !== 'boolean' ||
        typeof value.reclaimable !== 'boolean' ||
        !Array.isArray(value.dependencies) ||
        !value.dependencies.every(
            (name) => typeof name === 'string' && name.length > 0,
        )
    )
        throw new LifecycleBlocked(
            `Applied lifecycle metadata is missing or unsupported for ${service}. Apply configuration before using lazy services.`,
        );
    return value as AppliedServicePolicy;
}

export const mockRuntimeService = 'chs-dev-microcks';

/** The legacy Traefik container in the checkout's infrastructure compose. */
export const ingressProxyService = 'ingress-proxy';

/**
 * The daemon-hosted proxy replaces Traefik locally. Flip to false for
 * rollback: generated artifacts include the ingress-proxy container again
 * and the old router labels keep driving it.
 */
export const ingressProxyRetired = true;

export function withoutRetiredProxy(
    inventory: InventoryEntry[],
    retired: boolean = ingressProxyRetired,
): InventoryEntry[] {
    return retired
        ? inventory.filter((entry) => entry.service !== ingressProxyService)
        : inventory;
}

export function withMockRuntime(inventory: InventoryEntry[]): InventoryEntry[] {
    if (!inventory.some((entry) => entry.mockScenario)) return inventory;
    return [...inventory, { service: mockRuntimeService, mode: 'Mock' }];
}

export function mockOnlyInventory(
    inventory: readonly InventoryEntry[],
): boolean {
    return (
        inventory.some((entry) => entry.mockScenario) &&
        inventory.every(
            (entry) =>
                entry.mockScenario ||
                entry.service === mockRuntimeService ||
                entry.service === 'ingress-proxy',
        )
    );
}

/** Learned-lazy rule: only derived (unpinned, unlabelled) members, never explicit. */
function learnedLazy(entry: {
    pinned: boolean;
    labelled: boolean;
    explicitLazy: boolean;
    learned: boolean;
}): boolean {
    return (
        !entry.pinned && !entry.labelled && !entry.explicitLazy && entry.learned
    );
}

/**
 * The lazy/reclaimable flags shared by the state resolver and the project
 * selection: direct selections always start, only derived members honour the
 * `chs.start-mode: lazy` label and the usage cache, and derived members the
 * cache may learn about are reclaimable.
 */
export function inventoryFlags(entry: {
    pinned: boolean;
    labelled: boolean;
    lazyLabel: boolean;
    mock: boolean;
    explicitLazy: boolean;
    learned: boolean;
}): Pick<InventoryEntry, 'lazy' | 'lazySource' | 'reclaimable'> {
    const derived = !entry.pinned && !entry.labelled && !entry.mock;
    const learned = learnedLazy(entry);
    const flags: Pick<InventoryEntry, 'lazy' | 'lazySource' | 'reclaimable'> =
        {};
    if (entry.explicitLazy || learned || (!entry.pinned && entry.lazyLabel))
        flags.lazy = true;
    if (learned) flags.lazySource = 'learned';
    if (derived) flags.reclaimable = true;
    return flags;
}

/** One enabled service considered by the effective start-mode pass. */
export interface StartModeCandidate {
    service: string;
    /** Directly selected (service, module, base or journey root). */
    pinned: boolean;
    base: boolean;
    development: boolean;
    mock: boolean;
    label?: 'lazy' | 'always';
    override?: 'lazy' | 'always';
    /** Explicit journey `lazy:` member. */
    explicitLazy: boolean;
    learned: boolean;
}

/** The lazy flags an effective start-mode decision contributes to an entry. */
export type StartModeFlags = Pick<
    InventoryEntry,
    'lazy' | 'lazySource' | 'startModeSource' | 'reclaimable'
>;
type LazyFlags = StartModeFlags;

/** Reclaimable flag: derived, unlabelled, real services only. */
function reclaimableFlags(candidate: StartModeCandidate): LazyFlags {
    return !candidate.pinned && candidate.label === undefined && !candidate.mock
        ? { reclaimable: true }
        : {};
}

/** Seeds decided before inheritance: override, journey, pin and lazy label. */
function seededLazy(candidate: StartModeCandidate): LazyFlags | undefined {
    const reclaimable = reclaimableFlags(candidate);
    if (candidate.base || candidate.development) return reclaimable;
    if (candidate.override === 'lazy')
        return { ...reclaimable, lazy: true, startModeSource: 'override' };
    if (candidate.override) return reclaimable;
    if (candidate.explicitLazy)
        return { ...reclaimable, lazy: true, startModeSource: 'journey' };
    if (candidate.pinned) return reclaimable;
    if (candidate.label === 'lazy')
        return { ...reclaimable, lazy: true, startModeSource: 'label' };
    return undefined;
}

function parentMap(
    candidates: readonly StartModeCandidate[],
    dependencies: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
    const names = new Set(candidates.map((candidate) => candidate.service));
    const parents = new Map<string, string[]>(
        candidates.map((candidate) => [candidate.service, []]),
    );
    for (const candidate of candidates) {
        for (const dependency of dependencies.get(candidate.service) ?? []) {
            if (names.has(dependency))
                parents.get(dependency)!.push(candidate.service);
        }
    }
    return parents;
}

/**
 * Effective start modes over the enabled closure. Precedence: user override,
 * journey lists, manual enablement, `chs.start-mode` label, inheritance from
 * lazy parents, then the learned usage cache. Base and Development-mode
 * services are never lazy. An unlabelled (or `always`-labelled) service
 * inherits lazy only when every enabled service directly depending on it is
 * lazy, so whole exclusive subtrees defer with their lazy root.
 */
/** Promotes pending members whose every direct parent is already lazy. */
function inheritPending(
    decided: Map<string, LazyFlags>,
    pending: Map<string, StartModeCandidate>,
    parents: Map<string, string[]>,
): void {
    const allParentsLazy = (name: string) => {
        const direct = parents.get(name) ?? [];
        return (
            direct.length > 0 &&
            direct.every((parent) => decided.get(parent)?.lazy)
        );
    };
    let changed = true;
    while (changed) {
        changed = false;
        for (const [name, candidate] of pending) {
            if (!allParentsLazy(name)) continue;
            decided.set(name, {
                lazy: true,
                startModeSource: 'inherited',
                ...reclaimableFlags(candidate),
            });
            pending.delete(name);
            changed = true;
        }
    }
}

/** Settles remaining members, applying the learned usage-cache rule. */
function settlePending(
    decided: Map<string, LazyFlags>,
    pending: Map<string, StartModeCandidate>,
): void {
    for (const candidate of pending.values()) {
        const learned = learnedLazy({
            pinned: candidate.pinned,
            labelled: candidate.label !== undefined,
            explicitLazy: candidate.explicitLazy,
            learned: candidate.learned,
        });
        decided.set(candidate.service, {
            ...reclaimableFlags(candidate),
            ...(learned
                ? {
                      lazy: true as const,
                      lazySource: 'learned' as const,
                      startModeSource: 'learned' as const,
                  }
                : {}),
        });
    }
}

export function effectiveStartModes(
    candidates: readonly StartModeCandidate[],
    dependencies: ReadonlyMap<string, readonly string[]>,
): Map<string, LazyFlags> {
    const decided = new Map<string, LazyFlags>();
    const pending = new Map<string, StartModeCandidate>();
    for (const candidate of candidates) {
        const seeded = seededLazy(candidate);
        if (seeded) decided.set(candidate.service, seeded);
        else pending.set(candidate.service, candidate);
    }
    inheritPending(decided, pending, parentMap(candidates, dependencies));
    settlePending(decided, pending);
    return decided;
}
export interface ConfigurationRevision {
    identity: string;
    yaml: string;
    inventory: readonly InventoryEntry[];
}
export interface PreparedProject {
    protocolVersion: 1;
    projectName: string;
    projectDirectory: string;
    configurationIdentity: string;
    composeFiles: string[];
    sources?: Record<string, string>;
    inventory: InventoryEntry[];
    environmentRequirements: string[];
    sshRequirements?: SshSecretRequirement[];
    /** Durable start: services excluded because required variables are missing. */
    exclusions?: PreparationExclusion[];
    /** Missing variables attributable to no service; the stack starts regardless. */
    unattributable?: string[];
}
export interface PreparationExclusion {
    /** The missing variable this exclusion attributes to. */
    variable: string;
    /** The owning services plus their transitive dependents, sorted. */
    services: string[];
    cause: string;
    remediation: string;
}
export interface SshSecretRequirement {
    kind: 'container-ssh-secrets' | 'docker-ssh-secrets';
    services: string[];
    keyPath: string;
    passphrasePath: string;
}

/** Drops excluded services from SSH requirements; empty requirements are removed. */
export function filterSshRequirements(
    requirements: readonly SshSecretRequirement[],
    excluded: ReadonlySet<string>,
): SshSecretRequirement[] {
    return requirements
        .map((requirement) => ({
            ...requirement,
            services: requirement.services.filter(
                (service) => !excluded.has(service),
            ),
        }))
        .filter((requirement) => requirement.services.length > 0);
}
export type SshFileState = 'missing' | 'valid' | 'invalid';
export interface SshSetupStatus {
    requirements: SshSecretRequirement[];
    keyState: SshFileState;
    passphraseState: SshFileState;
    existingKey?: string;
    discoveredKey?: string;
    ready: boolean;
    message: string;
}
export interface SshSetupService {
    inspect(
        requirements: readonly SshSecretRequirement[],
        signal?: AbortSignal,
    ): Promise<SshSetupStatus>;
    setup(
        requirements: readonly SshSecretRequirement[],
        input: {
            keyPath: string;
            passphrase: string;
            replace: boolean;
        },
        signal?: AbortSignal,
    ): Promise<void>;
}
export interface RuntimeContainer {
    service: string;
    id: string;
    incarnation?: string;
    /** Actual engine image reference and content ID from container inspection. */
    image?: string;
    imageId?: string;
    projectName: string;
    projectDirectory: string;
    configurationIdentity?: string;
    mode?: ServiceMode;
    ownerService?: string;
    lifecycle: string;
    kind?: 'service' | 'job';
    health?: string;
    exitCode?: number;
    oomKilled?: boolean;
    policy?: AppliedServicePolicy;
    composeFiles?: readonly string[];
}
export interface RuntimeSnapshot {
    projectName: string;
    projectDirectory: string;
    containers: RuntimeContainer[];
}
export interface LiveApplyContext extends OperationContext {
    stoppedServices?: readonly string[];
}

export interface LiveRuntime {
    probe?(context: OperationContext): Promise<void>;
    monitor?(context: OperationContext): Promise<void>;
    close?(): Promise<void>;
    checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability>;
    snapshot(signal?: AbortSignal): Promise<RuntimeSnapshot>;
    reloadApplied(
        service: string,
        context: OperationContext,
    ): Promise<RuntimeOperationResult>;
    /** Starts from owned immutable applied artifacts, preserving Compose conditions. */
    startApplied(
        service: string,
        context: OperationContext,
    ): Promise<RuntimeOperationResult>;
    apply(
        project: PreparedProject,
        context: LiveApplyContext,
    ): Promise<RuntimeOperationResult>;
    stop(
        containers: RuntimeContainer[],
        context: OperationContext,
    ): Promise<RuntimeOperationResult>;
    /** Stops and removes every container of this checkout, never volumes. */
    stopProject(context: OperationContext): Promise<RuntimeOperationResult>;
    containerAction(
        action: ContainerAction,
        containers: RuntimeContainer[],
        context: OperationContext,
    ): Promise<RuntimeOperationResult>;
    /** Rebuilds images and recreates every container owned by the given services, builders included. */
    reload(
        project: PreparedProject,
        services: readonly string[],
        context: OperationContext,
    ): Promise<RuntimeOperationResult>;
    logs(
        container: RuntimeContainer,
        options: { tail: number },
        signal?: AbortSignal,
    ): Promise<string[]>;
}
export type ContainerAction = 'restart' | 'stop' | 'start';
export interface RuntimeOperationResult extends OperationResult {
    affectedServices: string[];
    failureKind?: 'blocked' | 'aws' | 'ecr' | 'failed';
}
export interface PreparationApi {
    check(signal?: AbortSignal): Promise<void>;
    resolve(
        revision: ConfigurationRevision,
        context: OperationContext,
    ): Promise<
        Pick<
            PreparedProject,
            | 'inventory'
            | 'projectName'
            | 'projectDirectory'
            | 'configurationIdentity'
            | 'sshRequirements'
        >
    >;
    prepare(
        revision: ConfigurationRevision,
        context: OperationContext,
    ): Promise<PreparedProject>;
    cleanup?(): Promise<void>;
}
export interface LivePreview {
    start: string[];
    stop: string[];
    recreate: string[];
}
export type LivePhase =
    | 'Stopped'
    | 'Checking'
    | 'Preparing'
    | 'Applying'
    | 'Stopping'
    | 'Running'
    | 'Blocked'
    | 'Failed'
    | 'Cancelling';
export type EnvironmentAction = 'start' | 'apply' | 'stop' | 'service';
export type BlockedReason =
    'aws' | 'ecr' | 'ssh' | 'cancelled' | 'unavailable' | 'mismatch' | 'other';
export interface EnvironmentChanges extends LivePreview {
    /** Services whose container mode differs from the saved configuration. */
    modeChanged: string[];
    /** The saved configuration changed since it was last applied. */
    edited: boolean;
}
export interface LiveState {
    /** The user's intent: the environment should be running. */
    running: boolean;
    /** Compatibility field: saves always wait for explicit Apply or Start. */
    autoApply: boolean;
    phase: LivePhase;
    action?: EnvironmentAction;
    blocked?: BlockedReason;
    message: string;
    /** Busy description for service actions, e.g. "Restarting api…". */
    activity?: string;
    /** A start plan awaiting confirmation because it stops unlisted services. */
    plan?: LivePreview;
    /** Difference between saved configuration and containers. */
    changes?: EnvironmentChanges;
    stoppedByUser: readonly string[];
    /** Durable-start exclusions from the last apply, with cause and remediation. */
    exclusions?: readonly PreparationExclusion[];
    observed?: RuntimeSnapshot;
    logs: readonly string[];
    logSequence: number;
    /** Sequence at the start of the current operation; history remains available in logs. */
    operationLogStart?: number;
    busy: boolean;
    sshSetup?: SshSetupStatus;
}
export class LiveFailure extends Error {
    constructor(
        message: string,
        readonly kind: 'blocked' | 'aws' | 'ecr' | 'failed' = 'failed',
        readonly reason?: BlockedReason,
    ) {
        super(message);
    }
}
/** A controlled automatic-lifecycle denial safe to show to a local requester. */
export class LifecycleBlocked extends LiveFailure {
    constructor(message: string) {
        super(message, 'blocked');
    }
}

export class PlanChangeRequired extends LiveFailure {
    constructor(readonly plan: LivePreview) {
        super(
            'The container state changed. Review the revised stop plan.',
            'blocked',
        );
    }
}

export class SshSetupRequired extends LiveFailure {
    constructor(readonly status: SshSetupStatus) {
        super(status.message, 'blocked');
    }
}
export function inventoryKey(inventory: readonly InventoryEntry[]): string {
    return JSON.stringify(
        [...inventory].sort((a, b) => a.service.localeCompare(b.service)),
    );
}
export function previewChanges(
    revision: ConfigurationRevision,
    actual: RuntimeSnapshot,
): LivePreview {
    const running = actual.containers.filter(
        (container) =>
            !['exited', 'dead', 'created'].includes(container.lifecycle),
    );
    const satisfied = [...running, ...actual.containers.filter(isCompletedJob)];
    // A lazy service with an existing (created or stopped) container is in
    // its intended state: it starts on first use, not on Apply.
    const deferred = actual.containers.filter((container) =>
        revision.inventory.some(
            (entry) => entry.lazy && entry.service === container.service,
        ),
    );
    return {
        start: revision.inventory
            .filter(
                (entry) =>
                    !satisfied.some(
                        (container) => container.service === entry.service,
                    ) &&
                    !deferred.some(
                        (container) => container.service === entry.service,
                    ),
            )
            .map((entry) => entry.service),
        stop: [
            ...new Set(
                running
                    .filter(
                        (container) => !retainsContainer(revision, container),
                    )
                    .map((container) => container.service),
            ),
        ],
        recreate: revision.inventory
            .filter((entry) =>
                satisfied.some(
                    (container) => container.service === entry.service,
                ),
            )
            .map((entry) => entry.service),
    };
}

/** One-shot jobs (e.g. database script runners) exit 0 once done; that is their desired state. */
export function isCompletedJob(container: RuntimeContainer): boolean {
    return (
        container.kind !== 'service' &&
        container.lifecycle === 'exited' &&
        container.exitCode === 0 &&
        container.health === undefined
    );
}

export function retainsContainer(
    revision: ConfigurationRevision,
    container: RuntimeContainer,
): boolean {
    return revision.inventory.some(
        (entry) =>
            entry.service === container.service ||
            (entry.service === container.ownerService &&
                entry.mode === 'Development'),
    );
}

// Unknown modes require preparation, rather than assuming a destructive edit is stop-only.
export function isStopOnly(
    revision: ConfigurationRevision,
    actual: RuntimeSnapshot,
): boolean {
    // Mocks still need preparation to publish scenario files during stop-only plans.
    if (revision.inventory.some((entry) => entry.mockScenario)) return false;
    return revision.inventory.every((entry) =>
        actual.containers.some(
            (container) =>
                container.service === entry.service &&
                container.mode === entry.mode &&
                (['running', 'restarting', 'paused'].includes(
                    container.lifecycle,
                ) ||
                    isCompletedJob(container)),
        ),
    );
}
