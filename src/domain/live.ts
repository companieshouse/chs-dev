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
}
export interface SshSecretRequirement {
    kind: 'container-ssh-secrets' | 'docker-ssh-secrets';
    services: string[];
    keyPath: string;
    passphrasePath: string;
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
}
export interface RuntimeSnapshot {
    projectName: string;
    projectDirectory: string;
    containers: RuntimeContainer[];
}
export interface LiveRuntime {
    probe?(context: OperationContext): Promise<void>;
    monitor?(context: OperationContext): Promise<void>;
    close?(): Promise<void>;
    readonly reconciles?: boolean;
    reloadTargets?: readonly string[];
    allowedRemovals?: readonly string[];
    checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability>;
    snapshot(signal?: AbortSignal): Promise<RuntimeSnapshot>;
    apply(
        project: PreparedProject,
        context: OperationContext,
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
    autoApply: boolean;
    deferredConfigurationRevision?: string;
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
    return {
        start: revision.inventory
            .filter(
                (entry) =>
                    !satisfied.some(
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
