import { rethrowIfAborted } from '../cancellation.js';
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
    LiveRuntime,
    PreparedProject,
    RuntimeContainer,
    RuntimeSnapshot,
    ContainerAction,
    RuntimeOperationResult,
} from '../../domain/live.js';
import { LiveFailure, PlanChangeRequired } from '../../domain/live.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';
import type {
    RuntimeAdapter,
    ObservedContainer,
} from '../../domain/runtime-adapter.js';
import type {
    ResolvedProject,
    DependencyCondition,
    Mount,
    PlannedAction,
    ServiceSpec,
} from '../../domain/orchestration.js';
import {
    dependencyOrder,
    planProject,
    executeGraph,
} from '../../domain/orchestration.js';
import { type DefinitionCompiler } from './compiler.js';
import {
    DockerRuntimeAdapter,
    type DockerAdapterDependencies,
} from './docker-adapter.js';
import { NativeState } from './state.js';
import { PortableDefinitionCompiler } from './portable-compiler.js';
import { PortableChsAdapter, adaptPortableProject } from './portable-chs.js';

const defaultPolicy = {
    concurrency: 4,
    pulls: 2,
    readinessMs: 600000,
    jobMs: 1800000,
    pollMs: 1000,
    progressMs: 5000,
};
export interface OrchestrationDependencies {
    directory: string;
    projectName: string;
    stateDirectory: string;
    adapter: RuntimeAdapter;
    compiler: DefinitionCompiler;
    adapt?(
        project: ResolvedProject,
        prepared: PreparedProject,
        stateDirectory: string,
    ): Promise<void>;
    policy?: Partial<typeof defaultPolicy>;
}
export interface NativeDependencies extends DockerAdapterDependencies {
    stateDirectory: string;
    compiler?: DefinitionCompiler;
    policy?: Partial<typeof defaultPolicy>;
}
const ok = (
    message: string,
    services: string[] = [],
): RuntimeOperationResult => ({
    outcome: 'success',
    message,
    affectedServices: services,
});
const active = (state: string) =>
    !['created', 'exited', 'dead'].includes(state);

/** Project orchestration depends on normalized runtime ports, never engine requests. */
function healthSettlement(
    container: ObservedContainer,
): 'ready' | Error | undefined {
    if (container.health === 'healthy') return 'ready';
    if (!container.health)
        return new Error(
            `${container.service}: dependency requires a health check`,
        );
    if (container.health === 'unhealthy')
        return new Error(`${container.service}: unhealthy`);
    return undefined;
}
function readinessCondition(
    container: Pick<ObservedContainer, 'kind' | 'health'>,
): DependencyCondition {
    if (container.kind === 'job') return 'service_completed_successfully';
    return container.health ? 'service_healthy' : 'service_started';
}
function restartsAfterTarget(
    container: ObservedContainer,
    targets: Set<string>,
) {
    return Object.entries(container.dependencies).some(
        ([name, rule]) => targets.has(name) && rule.restart,
    );
}

function propagateRestartTargets(
    current: ObservedContainer[],
    targets: Set<string>,
) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const container of current) {
            if (targets.has(container.service)) continue;
            if (restartsAfterTarget(container, targets)) {
                targets.add(container.service);
                changed = true;
            }
        }
    }
}
function hasHealthCheck(dependency: ServiceSpec) {
    const test = dependency.health?.test;
    return (
        test?.[0] !== 'NONE' &&
        (Boolean(test?.length) || dependency.imageHasHealth)
    );
}

function serviceHasStarted(container: ObservedContainer) {
    return (
        container.lifecycle === 'running' ||
        (container.kind === 'job' &&
            container.lifecycle === 'exited' &&
            container.exitCode === 0)
    );
}

export class NativeOrchestrator implements LiveRuntime {
    readonly reconciles = true;
    reloadTargets?: readonly string[];
    allowedRemovals?: readonly string[];
    private readonly state: NativeState;
    private readonly policy;
    private readonly adapter: RuntimeAdapter;
    constructor(private readonly dependencies: OrchestrationDependencies) {
        this.state = new NativeState(
            join(
                dependencies.stateDirectory,
                dependencies.adapter.stateKey ?? 'native',
            ),
        );
        this.policy = { ...defaultPolicy, ...dependencies.policy };
        this.adapter = dependencies.adapter;
    }
    async commandEnvironment(signal?: AbortSignal) {
        return this.adapter.environment([], signal);
    }
    async monitor(context: OperationContext) {
        await this.adapter.monitor?.(context);
    }
    async probe(context: OperationContext) {
        await this.adapter.probe?.(context);
    }
    async close() {
        await this.adapter.close?.();
    }
    async checkAvailability(signal?: AbortSignal) {
        const available = await this.adapter.checkAvailability(signal);
        if (!available.available) return available;
        try {
            await this.dependencies.compiler.checkAvailability?.({
                signal,
                environment: await this.commandEnvironment(signal),
            });
            return available;
        } catch (error) {
            rethrowIfAborted(signal, error);
            return {
                available: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
    async snapshot(signal?: AbortSignal): Promise<RuntimeSnapshot> {
        return {
            projectName: this.dependencies.projectName,
            projectDirectory: this.dependencies.directory,
            containers: await this.adapter.containers.list(signal),
        };
    }
    /** Fails when a mount references a missing volume or an absent host path. */
    private async validateMount(
        resolved: ResolvedProject,
        spec: ServiceSpec,
        mount: Mount,
    ) {
        if (
            mount.type === 'volume' &&
            mount.source &&
            !resolved.volumes[mount.source]
        )
            throw new Error(
                `${spec.source}: ${spec.name} references missing volume ${mount.source}`,
            );
        if (mount.type !== 'bind' || !mount.source || mount.daemonSource)
            return;
        try {
            await stat(mount.source);
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
                !mount.createHostPath
            )
                throw new Error(
                    `${spec.source}: ${spec.name} requires mount ${mount.source}`,
                );
            await mkdir(mount.source, {
                recursive: true,
                mode: 0o700,
            });
        }
    }
    private async prepare(project: PreparedProject, context: OperationContext) {
        if (
            project.projectDirectory !== this.dependencies.directory ||
            project.projectName !== this.dependencies.projectName
        )
            throw new LiveFailure(
                'Prepared project identity mismatch.',
                'blocked',
            );
        await this.state.initialize();
        await this.adapter.preflight(undefined, context.signal);
        const environment = await this.adapter.environment(
            project.environmentRequirements,
            context.signal,
        );
        const resolved = await this.dependencies.compiler.compile(project, {
            ...context,
            environment,
        });
        await this.dependencies.adapt?.(
            resolved,
            project,
            this.state.directory,
        );
        for (const spec of Object.values(resolved.services))
            for (const mount of spec.mounts)
                await this.validateMount(resolved, spec, mount);
        await this.adapter.preflight(resolved, context.signal);
        await this.adapter.resources.ensure(
            resolved,
            false,
            (value) => this.state.digest(value),
            context,
        );
        return resolved;
    }
    /** 'ready' when the condition is satisfied; an Error when it has failed; undefined while pending. */
    private settlementFor(
        container: ObservedContainer,
        condition: DependencyCondition,
    ): 'ready' | Error | undefined {
        if (
            condition === 'service_completed_successfully' &&
            container.lifecycle === 'exited'
        ) {
            if (container.exitCode === 0) return 'ready';
            return new Error(
                container.exitCode === undefined
                    ? `${container.service}: job result is unknown. Apply again to rerun it; dependent services have not been started.`
                    : `${container.service}: job exited ${container.exitCode}`,
            );
        }
        if (condition === 'service_started' && serviceHasStarted(container))
            return 'ready';
        if (condition === 'service_healthy') return healthSettlement(container);
        return undefined;
    }
    private readinessFailure(container: ObservedContainer) {
        return new Error(
            `${container.service}: exited before readiness (${container.exitCode === undefined ? 'exit code unavailable; check container logs' : `code ${container.exitCode}`})`,
        );
    }
    private async waitFor(
        id: string,
        condition: DependencyCondition,
        context: OperationContext,
    ) {
        const deadline =
            Date.now() +
            (condition === 'service_completed_successfully'
                ? this.policy.jobMs
                : this.policy.readinessMs);
        let announced = false;
        while (true) {
            context.signal?.throwIfAborted();
            const container = await this.adapter.containers.inspectOwned(
                id,
                context.signal,
            );
            if (!announced) {
                context.onOutput?.({
                    stream: 'stdout',
                    text: `Wait: ${container.service} (${condition})`,
                });
                announced = true;
            }
            const settled = this.settlementFor(container, condition);
            if (settled === 'ready') return;
            if (settled) throw settled;
            if (['exited', 'dead'].includes(container.lifecycle))
                throw this.readinessFailure(container);
            if (Date.now() >= deadline)
                throw new Error(
                    `${container.service}: timed out waiting for ${condition}`,
                );
            await delay(this.policy.pollMs, undefined, {
                signal: context.signal,
            });
        }
    }
    private async withProgress<T>(
        message: string,
        context: OperationContext,
        work: () => Promise<T>,
    ): Promise<T> {
        context.signal?.throwIfAborted();
        context.onOutput?.({ stream: 'stdout', text: message });
        const started = Date.now();
        const timer = context.onOutput
            ? setInterval(() => {
                  if (!context.signal?.aborted)
                      context.onOutput?.({
                          stream: 'stdout',
                          text: `${message} — ${Math.floor((Date.now() - started) / 1000)}s elapsed; still waiting for ${this.adapter.name}`,
                      });
              }, this.policy.progressMs)
            : undefined;
        try {
            return await work();
        } finally {
            if (timer) clearInterval(timer);
        }
    }
    private async remove(
        id: string,
        context: OperationContext,
        position?: string,
    ) {
        const container = await this.adapter.containers.inspectOwned(
            id,
            context.signal,
        );
        await this.state.saveVolumes(
            container.service,
            container.anonymousVolumes,
        );
        const name = `${container.service}${position ? ` [${position}]` : ''}`;
        if (active(container.lifecycle))
            await this.withProgress(
                `Stopping: ${name} (grace period ${container.stopSeconds}s)`,
                context,
                () =>
                    this.adapter.containers.action('stop', container, context),
            );
        await this.withProgress(`Removing: ${name}`, context, () =>
            this.adapter.containers.remove(container, context),
        );
        context.onOutput?.({
            stream: 'stdout',
            text: `Removed: ${name}; volumes kept.`,
        });
    }
    private reverse(containers: ObservedContainer[]) {
        const selected = new Set(containers.map((c) => c.service));
        const services = Object.fromEntries(
            containers.map((c) => [
                c.service,
                {
                    dependencies: Object.fromEntries(
                        Object.entries(c.dependencies).filter(([name]) =>
                            selected.has(name),
                        ),
                    ),
                },
            ]),
        );
        return dependencyOrder(services)
            .reverse()
            .flatMap((name) => containers.filter((c) => c.service === name));
    }
    private assertHealthChecks(resolved: ResolvedProject, spec: ServiceSpec) {
        for (const [name, rule] of Object.entries(spec.dependencies)) {
            const dependency = resolved.services[name];
            if (
                dependency &&
                rule.condition === 'service_healthy' &&
                !hasHealthCheck(dependency)
            )
                throw new LiveFailure(
                    `${spec.name}: ${name} needs a health check for service_healthy.`,
                    'blocked',
                );
        }
    }
    private planApply(
        resolved: ResolvedProject,
        observed: ObservedContainer[],
        reload: readonly string[],
    ) {
        const plan = planProject(resolved, observed, { reload });
        const removals = plan.actions
            .filter(
                (a) =>
                    a.action === 'remove' &&
                    observed.some(
                        (c) => c.service === a.service && active(c.lifecycle),
                    ),
            )
            .map((a) => a.service);
        if (
            this.allowedRemovals &&
            removals.some((name) => !this.allowedRemovals!.includes(name))
        )
            throw new PlanChangeRequired({
                start: plan.actions
                    .filter(
                        (a) => a.action === 'create' || a.action === 'start',
                    )
                    .map((a) => a.service),
                stop: removals,
                recreate: plan.actions
                    .filter((a) => a.action === 'replace')
                    .map((a) => a.service),
            });
        return { plan, removals };
    }
    private async performAction(
        operation: string,
        resolved: ResolvedProject,
        ids: Map<string, string>,
        action: PlannedAction,
        context: OperationContext,
    ) {
        const spec = resolved.services[action.service];
        for (const [dep, rule] of Object.entries(spec.dependencies))
            if (ids.has(dep))
                await this.waitFor(ids.get(dep)!, rule.condition, context);
        await this.state.record(operation, action.action, spec.name, 'started');
        try {
            let id = ids.get(spec.name);
            if (action.action === 'replace' && id) {
                await this.remove(id, context);
                id = undefined;
            }
            if (action.action === 'create' || action.action === 'replace') {
                const created = await this.adapter.containers.create(
                    resolved,
                    spec,
                    await this.state.volumes(spec.name),
                    context,
                );
                id = created.id;
                ids.set(spec.name, id);
                await this.state.saveVolumes(
                    spec.name,
                    created.anonymousVolumes,
                );
            }
            if (action.action !== 'keep') {
                const current = await this.adapter.containers.inspectOwned(
                    id!,
                    context.signal,
                );
                await this.adapter.containers.action(
                    action.action === 'restart' ? 'restart' : 'start',
                    current,
                    context,
                );
            }
            await this.state.record(
                operation,
                action.action,
                spec.name,
                'success',
                id,
            );
        } catch (error) {
            await this.state.record(
                operation,
                action.action,
                spec.name,
                'failed',
            );
            throw error;
        }
    }
    private async awaitReadiness(
        resolved: ResolvedProject,
        ids: Map<string, string>,
        context: OperationContext,
    ) {
        await executeGraph(
            Object.values(resolved.services).map((spec) => ({
                id: spec.name,
                dependencies: [],
                run: async () => {
                    const current = await this.adapter.containers.inspectOwned(
                        ids.get(spec.name)!,
                        context.signal,
                    );
                    await this.waitFor(
                        current.id,
                        readinessCondition({
                            kind: spec.kind,
                            health: current.health,
                        }),
                        context,
                    );
                },
            })),
            this.policy.concurrency,
            context.signal,
        );
    }
    async apply(
        project: PreparedProject,
        context: OperationContext,
    ): Promise<RuntimeOperationResult> {
        const reload = this.reloadTargets ?? [];
        const resolved = await this.prepare(project, context);
        await this.adapter.images.prepare(resolved, reload, context);
        for (const spec of Object.values(resolved.services)) {
            this.assertHealthChecks(resolved, spec);
            spec.fingerprint = await this.state.fingerprint(spec);
        }
        const observed = await this.adapter.containers.list(context.signal);
        const { plan, removals } = this.planApply(resolved, observed, reload);
        const operation = randomUUID();
        for (const action of plan.actions)
            context.onOutput?.({
                stream: 'stdout',
                text: `${action.action}: ${action.service} — ${action.reason}`,
            });
        await this.adapter.preflight(resolved, context.signal);
        await this.adapter.resources.ensure(
            resolved,
            true,
            (value) => this.state.digest(value),
            context,
        );
        for (const container of this.reverse(
            observed.filter((c) => !resolved.services[c.service]),
        ))
            await this.remove(container.id, context);
        const ids = new Map(
            observed
                .filter((c) => !!resolved.services[c.service])
                .map((c) => [c.service, c.id]),
        );
        await executeGraph(
            plan.actions
                .filter((a) => a.action !== 'remove')
                .map((action) => ({
                    id: action.service,
                    dependencies: action.dependencies,
                    run: () =>
                        this.performAction(
                            operation,
                            resolved,
                            ids,
                            action,
                            context,
                        ),
                })),
            this.policy.concurrency,
            context.signal,
        );
        await this.awaitReadiness(resolved, ids, context);
        return ok(
            `Native ${this.adapter.name} configuration applied.`,
            plan.actions
                .filter((a) => a.action !== 'keep')
                .map((a) => a.service),
        );
    }
    async reload(
        project: PreparedProject,
        services: readonly string[],
        context: OperationContext,
    ) {
        this.reloadTargets = services;
        try {
            return await this.apply(project, context);
        } finally {
            this.reloadTargets = undefined;
        }
    }
    async stop(containers: RuntimeContainer[], context: OperationContext) {
        return this.stopContainers(containers, context);
    }
    private async stopContainers(
        requested: RuntimeContainer[] | undefined,
        context: OperationContext,
    ) {
        await this.state.initialize();
        const current = (
            await this.withProgress(
                'Inspecting native containers before stopping',
                context,
                () => this.adapter.containers.list(context.signal),
            )
        ).filter(
            (c) => !requested || requested.some((target) => target.id === c.id),
        );
        const ordered = this.reverse(current);
        context.onOutput?.({
            stream: 'stdout',
            text: `Stopping ${ordered.length} native containers in dependency order; data volumes will be kept.`,
        });
        for (const [index, container] of ordered.entries())
            await this.remove(
                container.id,
                context,
                `${index + 1}/${ordered.length}`,
            );
        return ok(
            `Removed ${ordered.length} native containers. Data volumes were kept.`,
            current.map((c) => c.service),
        );
    }
    async stopProject(context: OperationContext) {
        return this.stopContainers(undefined, context);
    }
    async containerAction(
        action: ContainerAction,
        containers: RuntimeContainer[],
        context: OperationContext,
    ) {
        const current = await this.adapter.containers.list(context.signal);
        const targets = new Set(containers.map((c) => c.service));
        if (action === 'restart') propagateRestartTargets(current, targets);
        const ordered = this.reverse(
            current.filter((c) => targets.has(c.service)),
        );
        if (action !== 'stop') ordered.reverse();
        for (const container of ordered) {
            const requested = containers.find(
                (c) => c.service === container.service,
            );
            if (
                requested &&
                (requested.id !== container.id ||
                    requested.incarnation !== container.incarnation)
            )
                throw new LiveFailure(
                    'Container changed since the action was requested.',
                    'blocked',
                );
            await this.adapter.containers.action(action, container, context);
            if (action !== 'stop')
                await this.waitFor(
                    container.id,
                    readinessCondition(container),
                    context,
                );
        }
        return ok(
            `Native ${this.adapter.name} ${action} completed.`,
            ordered.map((c) => c.service),
        );
    }
    async logs(
        container: RuntimeContainer,
        options: { tail: number },
        signal?: AbortSignal,
    ) {
        return this.adapter.containers.logs(container.id, options.tail, signal);
    }
}

/** Composition root for Docker; another engine supplies its own adapter and preparation. */
export class NativeDockerRuntime extends NativeOrchestrator {
    constructor(dependencies: NativeDependencies) {
        super({
            directory: dependencies.directory,
            get projectName() {
                return dependencies.projectName;
            },
            stateDirectory: dependencies.stateDirectory,
            adapter: new PortableChsAdapter(
                new DockerRuntimeAdapter(dependencies),
                join(dependencies.stateDirectory, 'native'),
            ),
            compiler: dependencies.compiler ?? new PortableDefinitionCompiler(),
            adapt: adaptPortableProject,
            policy: dependencies.policy,
        });
    }
}
