import type { RuntimeContainer, ServiceMode } from './live.js';

export type DependencyCondition =
    'service_started' | 'service_healthy' | 'service_completed_successfully';
export interface Dependency {
    condition: DependencyCondition;
    restart: boolean;
    required: boolean;
}
export interface Mount {
    type: 'bind' | 'volume' | 'tmpfs';
    source?: string;
    target: string;
    readOnly: boolean;
    createHostPath?: boolean;
    daemonSource?: boolean;
}
export interface ServiceSpec {
    initialization?: {
        target: string;
        directory: string;
        suffix: string;
        extension: string;
        force: boolean;
    };
    name: string;
    source: string;
    owner: string;
    mode: ServiceMode;
    kind: 'service' | 'job';
    image?: string;
    imageId?: string;
    /** Immutable repository reference when the image store exposes a manifest index. */
    imageReference?: string;
    imageVolumes?: string[];
    /** Source files projected into a directory by runtimes without file bind mounts. */
    fileInputs?: string[];
    imageHasHealth?: boolean;
    platform?: string;
    pullPolicy: 'missing' | 'always' | 'never' | 'build';
    build?: {
        context: string;
        dockerfile?: string;
        args: Record<string, string>;
        target?: string;
    };
    command?: string[] | null;
    entrypoint?: string[] | null;
    environment: Record<string, string>;
    labels: Record<string, string>;
    user?: string;
    workingDir?: string;
    hostname?: string;
    mounts: Mount[];
    ports: {
        target: number;
        published?: string;
        hostIp?: string;
        protocol: string;
    }[];
    expose: string[];
    networks: Record<string, { aliases: string[] }>;
    aliases: string[];
    dns: string[];
    dnsSearch: string[];
    extraHosts: string[];
    memory?: number;
    memoryReservation?: number;
    restart: string;
    stopSignal?: string;
    stopSeconds: number;
    health?: {
        shell?: string[];
        test?: string[];
        interval?: number;
        timeout?: number;
        retries?: number;
        startPeriod?: number;
        startInterval?: number;
    };
    dependencies: Record<string, Dependency>;
    fingerprint?: string;
}
export interface ResourceSpec {
    driver?: string;
    options?: Record<string, string>;
    labels?: Record<string, string>;
    internal?: boolean;
}
export interface ResolvedProject {
    identity: string;
    directory: string;
    namespace: string;
    services: Record<string, ServiceSpec>;
    networks: Record<string, ResourceSpec>;
    volumes: Record<string, ResourceSpec>;
}
export interface OperationIntent {
    reload?: readonly string[];
}
export interface PlannedAction {
    service: string;
    action: 'create' | 'replace' | 'start' | 'restart' | 'keep' | 'remove';
    reason: string;
    dependencies: string[];
}
export interface OperationPlan {
    actions: PlannedAction[];
}

function dependencyExists(
    services: Record<string, Pick<ServiceSpec, 'dependencies'>>,
    owner: string,
    name: string,
    required: boolean,
) {
    if (services[name]) return true;
    if (required) throw new Error(`${owner} requires missing service ${name}`);
    return false;
}

export function dependencyOrder(
    services: Record<string, Pick<ServiceSpec, 'dependencies'>>,
): string[] {
    const complete = new Set<string>();
    const visiting: string[] = [];
    const order: string[] = [];
    const visit = (name: string) => {
        if (complete.has(name)) return;
        if (visiting.includes(name))
            throw new Error(
                `Dependency cycle: ${[...visiting.slice(visiting.indexOf(name)), name].join(' -> ')}`,
            );
        visiting.push(name);
        for (const [dep, rule] of Object.entries(
            services[name].dependencies,
        ).sort()) {
            if (!dependencyExists(services, name, dep, rule.required)) continue;
            visit(dep);
        }
        visiting.pop();
        complete.add(name);
        order.push(name);
    };
    Object.keys(services).sort().forEach(visit);
    return order;
}

function serviceSettled(spec: ServiceSpec, current: RuntimeContainer) {
    if (['running', 'restarting'].includes(current.lifecycle)) return true;
    return (
        spec.kind === 'job' &&
        current.lifecycle === 'exited' &&
        current.exitCode === 0
    );
}

function planService(
    name: string,
    spec: ServiceSpec,
    current: RuntimeContainer | undefined,
    intent: OperationIntent,
): { action: PlannedAction['action']; reason: string } {
    if (!current) return { action: 'create', reason: 'Container missing' };
    if (
        intent.reload?.includes(spec.owner) ||
        current.configurationIdentity !== spec.fingerprint
    )
        return {
            action: 'replace',
            reason: intent.reload?.includes(spec.owner)
                ? 'Development reload requested'
                : 'Configuration or image changed',
        };
    if (current.lifecycle === 'paused')
        throw new Error(`${name} is paused; unpause it before applying.`);
    if (!serviceSettled(spec, current))
        return {
            action: 'start',
            reason: 'Container is not running or job failed',
        };
    return { action: 'keep', reason: 'Configuration and image unchanged' };
}

function needsDependencyRestart(
    spec: ServiceSpec,
    actions: readonly PlannedAction[],
): boolean {
    return Object.entries(spec.dependencies).some(
        ([dep, rule]) =>
            rule.restart &&
            actions.some((a) => a.service === dep && a.action !== 'keep'),
    );
}

export function planProject(
    project: ResolvedProject,
    containers: readonly RuntimeContainer[],
    intent: OperationIntent = {},
): OperationPlan {
    const order = dependencyOrder(project.services);
    const actions: PlannedAction[] = [];
    for (const name of order) {
        const spec = project.services[name];
        const matches = containers.filter((c) => c.service === name);
        if (matches.length > 1)
            throw new Error(
                `Multiple owned containers for ${name}; refusing ambiguous reconciliation.`,
            );
        const planned = planService(name, spec, matches[0], intent);
        if (
            planned.action === 'keep' &&
            needsDependencyRestart(spec, actions)
        ) {
            planned.action = spec.kind === 'job' ? 'replace' : 'restart';
            planned.reason = 'Dependency updated';
        }
        actions.push({
            service: name,
            action: planned.action,
            reason: planned.reason,
            dependencies: Object.keys(spec.dependencies).filter(
                (d) => !!project.services[d],
            ),
        });
    }
    for (const c of containers)
        if (!project.services[c.service])
            actions.push({
                service: c.service,
                action: 'remove',
                reason: 'No longer selected',
                dependencies: [],
            });
    return { actions };
}

export interface ScheduledTask {
    id: string;
    dependencies: string[];
    run(): Promise<void>;
}
function launchReadyTasks(
    state: {
        failure: unknown;
        remaining: Map<string, ScheduledTask>;
        completed: Set<string>;
        running: Map<string, Promise<void>>;
    },
    concurrency: number,
    signal: AbortSignal | undefined,
): void {
    for (const [id, task] of state.remaining) {
        if (state.running.size >= concurrency) break;
        if (!task.dependencies.every((d) => state.completed.has(d))) continue;
        state.remaining.delete(id);
        const promise = Promise.resolve()
            .then(() => {
                signal?.throwIfAborted();
                return task.run();
            })
            .then(
                () => {
                    state.completed.add(id);
                },
                (error) => {
                    state.failure ??= error;
                },
            )
            .finally(() => {
                state.running.delete(id);
            });
        state.running.set(id, promise);
    }
}

/** Stop scheduling on failure, but settle every action already in flight. */
export async function executeGraph(
    tasks: ScheduledTask[],
    concurrency = 4,
    signal?: AbortSignal,
): Promise<void> {
    const state = {
        failure: undefined as unknown,
        remaining: new Map(tasks.map((t) => [t.id, t])),
        completed: new Set<string>(),
        running: new Map<string, Promise<void>>(),
    };
    while (state.remaining.size || state.running.size) {
        state.failure ??= cancellationFailure(signal);
        if (!state.failure) launchReadyTasks(state, concurrency, signal);
        if (state.running.size) await Promise.race(state.running.values());
        else if (state.failure) throw state.failure;
        else if (state.remaining.size)
            throw new Error(
                `Blocked operation graph: ${[...state.remaining.keys()].join(', ')}`,
            );
    }
    if (state.failure) throw state.failure;
}

function cancellationFailure(signal?: AbortSignal): unknown {
    if (!signal?.aborted) return undefined;
    return signal.reason ?? new Error('Cancelled');
}
