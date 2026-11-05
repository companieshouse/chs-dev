import {
    mkdir,
    readFile,
    writeFile,
    readdir,
    rename,
    rm,
    chmod,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parse, stringify } from 'yaml';
import type {
    ResolvedProject,
    ServiceSpec,
} from '../../domain/orchestration.js';
import type {
    RuntimeAdapter,
    ObservedContainer,
} from '../../domain/runtime-adapter.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';
import type { PreparedProject } from '../../domain/live.js';
import { safeLog } from '../../domain/live-logs.js';
import { LiveFailure } from '../../domain/live.js';
import { optionalJson, privateJson } from './state-files.js';
import { canonical } from './state.js';
import { adaptAppleFileMounts } from './apple-file-mounts.js';
import { adaptChsProject } from './compatibility.js';

function adaptJobDependencyRules(project: ResolvedProject, spec: ServiceSpec) {
    for (const [dependency, rule] of Object.entries(spec.dependencies))
        if (
            project.services[dependency]?.kind === 'job' &&
            rule.condition === 'service_started'
        )
            rule.condition = 'service_completed_successfully';
}

function adaptExecuteScriptService(
    project: ResolvedProject,
    spec: ServiceSpec,
) {
    const root = spec.mounts.find(
        (m) => m.target.replace(/\/$/, '') === '/app/scripts',
    )?.source;
    const target =
        spec.environment.SCRIPT_CONTAINER_NAME_EXACT ??
        spec.environment.SCRIPT_CONTAINER_NAME;

    if (
        !root ||
        !target ||
        !project.services[target] ||
        !spec.environment.SCRIPT_SUFFIX
    )
        throw new Error(`${spec.name}: invalid initialization task`);

    spec.initialization = {
        target,
        directory: root,
        suffix: spec.environment.SCRIPT_SUFFIX,
        extension: spec.environment.SCRIPT_EXTENSION ?? 'sh',
        force: !!spec.environment.FORCE_RUN,
    };
    spec.mounts = spec.mounts.filter(withoutDockerSocket);
}

function adaptIngressProxy(spec: ServiceSpec, state: string) {
    spec.command = (spec.command ?? []).filter(
        (v) => !v.startsWith('--providers.docker'),
    );
    spec.command.push(
        '--providers.file.directory=/etc/chs-routing',
        '--providers.file.watch=true',
    );

    spec.mounts = spec.mounts.filter(withoutDockerSocket);
    spec.mounts.push({
        type: 'bind',
        source: join(state, 'discovery', 'routes'),
        target: '/etc/chs-routing',
        readOnly: false,
        createHostPath: true,
    });
    spec.dependencies = {};
}

async function adaptPrometheus(spec: ServiceSpec, state: string) {
    spec.mounts = spec.mounts.filter(
        (m) =>
            !['/var/run/docker.sock', '/var/lib/docker/containers'].includes(
                m.source ?? '',
            ),
    );

    const mount = spec.mounts.find((m) => m.target === '/etc/prometheus.yaml');
    if (!mount?.source) return;

    const config = parse(await readFile(mount.source, 'utf8'));
    for (const scrape of config.scrape_configs ?? []) {
        if (!scrape.docker_sd_configs) continue;

        delete scrape.docker_sd_configs;
        scrape.file_sd_configs = [
            {
                files: ['/etc/chs-targets/targets.json'],
                refresh_interval: '5s',
            },
        ];
    }

    const contents = stringify(config),
        file = join(
            state,
            'generated',
            `prometheus-portable-${createHash('sha256').update(contents).digest('hex')}.yaml`,
        );
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, contents, { mode: 0o644 });

    mount.source = file;
    spec.mounts.push({
        type: 'bind',
        source: join(state, 'discovery', 'targets'),
        target: '/etc/chs-targets',
        readOnly: true,
        createHostPath: true,
    });
}

async function adaptPortableService(
    project: ResolvedProject,
    spec: ServiceSpec,
    state: string,
) {
    adaptJobDependencyRules(project, spec);

    if (/^execute-.*-scripts$/.test(spec.name))
        return adaptExecuteScriptService(project, spec);
    if (spec.name === 'ingress-proxy') return adaptIngressProxy(spec, state);
    if (spec.name === 'prometheus') return adaptPrometheus(spec, state);
}

export async function adaptPortableProject(
    project: ResolvedProject,
    prepared: PreparedProject,
    state: string,
) {
    await adaptChsProject(project, prepared, state);
    for (const spec of Object.values(project.services))
        await adaptPortableService(project, spec, state);

    if (project.namespace.startsWith('chs-apple-'))
        await adaptAppleFileMounts(project, state);
}

type TaskRecord = {
    container: ObservedContainer;
    initialization: NonNullable<ServiceSpec['initialization']>;
    logs: string[];
};

type InitializationCheckpoint = {
    digest: string;
    // Older checkpoints contain only the digest and represent successful runs.
    exitCode?: number;
    diagnostic?: string;
};

interface DiscoveryRouter {
    rule?: string;
    priority?: number;
    ruleSyntax?: string;
    middlewares?: string[];
    service?: string;
}

interface DiscoveryHttp {
    routers: Record<string, DiscoveryRouter>;
    services: Record<string, { loadBalancer: { servers: { url: string }[] } }>;
    middlewares: Record<
        string,
        { headers: { accessControlAllowOriginList: string[] } }
    >;
}

interface DiscoveryTarget {
    targets: string[];
    labels: { chs_service: string; chs_project: string };
}

function routerProperty(
    property: string,
    value: string,
): Partial<DiscoveryRouter> {
    switch (property) {
        case 'priority':
            return { priority: Number(value) };
        case 'middlewares':
            return {
                middlewares: value
                    .split(',')
                    .map((entry) => entry.replace(/@docker$/, '@file')),
            };
        case 'rule':
            return { rule: value };
        case 'ruleSyntax':
            return { ruleSyntax: value };
        case 'service':
            return { service: value };
        default:
            throw new Error('Unsupported router property');
    }
}

const firstAddress = (addresses?: Record<string, string>) =>
    Object.values(addresses ?? {})[0];
const runtimeService = (spec: ServiceSpec) => !spec.initialization;
const withoutDockerSocket = (mount: ServiceSpec['mounts'][number]) =>
    mount.source !== '/var/run/docker.sock';

function networkAliases(spec: ServiceSpec) {
    return Object.values(spec.networks).flatMap((network) => network.aliases);
}

function discoveryServiceModel(spec: ServiceSpec) {
    const labels = Object.fromEntries(
        Object.entries(spec.labels).filter(
            ([key]) =>
                key.startsWith('traefik.') || key === 'chs.dev.dns-upstreams',
        ),
    );

    return {
        name: spec.name,
        labels,
        aliases: spec.aliases,
        networks: spec.networks,
        extraHosts: spec.extraHosts,
        expose: spec.expose,
        ports: spec.ports,
    };
}

type TaskExec = NonNullable<RuntimeAdapter['containers']['exec']>;

type TaskLog = {
    emit: (raw: string, stream?: 'stdout' | 'stderr') => void;
    warn: (
        path: string,
        checkpoint: InitializationCheckpoint,
        unchanged?: boolean,
    ) => void;
    count: () => number;
    lines: () => string[];
};

type ScriptRun = {
    container: ObservedContainer;
    task: NonNullable<ServiceSpec['initialization']>;
    target: ObservedContainer;
    identity: { current: string; legacy: string };
    context: OperationContext;
    log: TaskLog;
    exec: TaskExec;
};

const taskId = (name: string) => `task:${name}`;
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

async function waitForDnsRecord(
    resolver: Resolver,
    name: string,
    address: string,
    signal?: AbortSignal,
) {
    const deadline = Date.now() + 15000;

    while (true) {
        signal?.throwIfAborted();
        const answers: string[] = await (
            address.includes(':')
                ? resolver.resolve6(name)
                : resolver.resolve4(name)
        ).catch(() => [] as string[]);
        if (answers.includes(address)) break;

        if (Date.now() >= deadline)
            throw new Error(
                `Project DNS did not publish ${name} → ${address}. Check the chs-dns container logs.`,
            );

        await delay(200, undefined, { signal: signal });
    }
}

/** CHS tasks and generated discovery use the same implementation on either native engine. */
export class PortableChsAdapter implements RuntimeAdapter {
    readonly name: string;
    readonly stateKey?: string;
    private project?: ResolvedProject;
    private publishQueue: Promise<void> = Promise.resolve();
    private appliedDiscovery = '';
    private dnsRecords = new Map<string, string>();

    constructor(
        readonly inner: RuntimeAdapter,
        readonly state: string,
        readonly apple = false,
    ) {
        this.name = inner.name;
        this.stateKey = inner.stateKey;
    }

    checkAvailability(signal?: AbortSignal) {
        return this.inner.checkAvailability(signal);
    }

    environment(requirements: readonly string[], signal?: AbortSignal) {
        return this.inner.environment(requirements, signal);
    }

    private runtimeProject(project: ResolvedProject): ResolvedProject {
        return {
            ...project,
            services: Object.fromEntries(
                Object.entries(project.services).filter(([, v]) =>
                    runtimeService(v),
                ),
            ),
        };
    }

    private taskPath(id: string) {
        return join(this.state, 'tasks', hash(id) + '.json');
    }

    private async task(id: string) {
        const t = await optionalJson<TaskRecord>(this.taskPath(id));
        if (!t || t.container.id !== id)
            throw new Error(
                'Initialization task no longer exists. Apply the project again.',
            );

        return t;
    }

    private async taskList() {
        const root = join(this.state, 'tasks');
        let names: string[];

        try {
            names = await readdir(root);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];

            throw error;
        }

        const tasks = await Promise.all(
            names
                .filter((n) => n.endsWith('.json'))
                .map((n) => optionalJson<TaskRecord>(join(root, n))),
        );
        return tasks
            .filter((t): t is TaskRecord => !!t)
            .map((t) => t.container);
    }

    async preflight(project?: ResolvedProject, signal?: AbortSignal) {
        if (project) {
            this.project = project;
            await this.validateRouting(project);
            if (this.apple) {
                this.configureDns(project);
                await mkdir(join(this.state, 'discovery', 'dns'), {
                    recursive: true,
                    mode: 0o700,
                });
            }
            await this.saveDiscoveryModel(project);
        }

        await this.inner.preflight(
            project ? this.runtimeProject(project) : undefined,
            signal,
        );
    }

    readonly resources: RuntimeAdapter['resources'] = {
        ensure: async (project, create, fingerprint, context) => {
            await this.inner.resources.ensure(
                this.runtimeProject(project),
                create,
                fingerprint,
                context,
            );
            if (create) await this.publish(context);
        },
    };

    readonly images: RuntimeAdapter['images'] = {
        prepare: async (project, reload, context) => {
            const effective = this.runtimeProject(project);
            await this.inner.images.prepare(effective, reload, context);

            for (const spec of Object.values(project.services)) {
                if (!spec.initialization) continue;

                spec.imageId = 'chs-init-v1';
                spec.imageHasHealth = false;
            }
        },
    };

    readonly containers: RuntimeAdapter['containers'] = {
        list: async (signal) => [
            ...(await this.inner.containers.list(signal)),
            ...(await this.taskList()),
        ],
        inspectOwned: async (id, signal) =>
            id.startsWith('task:')
                ? (await this.task(id)).container
                : this.inner.containers.inspectOwned(id, signal),
        create: async (project, spec, volumes, context) => {
            if (spec.initialization)
                return this.createInitializationTask(
                    project,
                    spec,
                    spec.initialization,
                );

            const configured = await this.withProjectDns(spec, context);
            return this.inner.containers.create(
                project,
                configured,
                volumes,
                context,
            );
        },
        action: async (action, container, context) => {
            if (container.id.startsWith('task:')) {
                if (action === 'stop') return;

                await this.executeTask(container, context);
                return;
            }

            await this.inner.containers.action(action, container, context);
            await this.publish(context);
        },
        remove: async (container, context) => {
            if (container.id.startsWith('task:')) {
                const record = await this.task(container.id);
                if (record.container.incarnation !== container.incarnation)
                    throw new Error('Initialization task changed');

                await rm(this.taskPath(container.id), { force: true });
                return;
            }

            await this.inner.containers.remove(container, context);
            await this.publish(context);
        },
        logs: async (id, tail, signal) =>
            id.startsWith('task:')
                ? (await this.task(id)).logs.slice(-tail)
                : this.inner.containers.logs(id, tail, signal),
        exec: (id, args, context, stdin) =>
            this.inner.containers.exec!(id, args, context, stdin),
        copyTo: (id, source, target, context) =>
            this.inner.containers.copyTo!(id, source, target, context),
    };

    private async createInitializationTask(
        project: ResolvedProject,
        spec: ServiceSpec,
        initialization: TaskRecord['initialization'],
    ) {
        const record: TaskRecord = {
            container: {
                id: taskId(spec.name),
                incarnation: randomUUID(),
                service: spec.name,
                ownerService: spec.owner,
                kind: 'job',
                mode: spec.mode,
                configurationIdentity: spec.fingerprint,
                projectName: project.identity,
                projectDirectory: project.directory,
                lifecycle: 'created',
                dependencies: spec.dependencies,
                anonymousVolumes: {},
                stopSeconds: 0,
            },
            initialization,
            logs: [],
        };

        await privateJson(this.taskPath(record.container.id), record);
        return record.container;
    }

    private async withProjectDns(spec: ServiceSpec, context: OperationContext) {
        if (!this.apple || spec.name === 'chs-dns') return spec;

        const dns = (await this.inner.containers.list(context.signal)).find(
            (container) => container.service === 'chs-dns',
        );
        // A deterministic MAC keeps Apple's IPv6 address stable even when IPv4 changes on restart.
        const address = dns && firstAddress(dns.ipv6Addresses);
        const ipv4 = dns && firstAddress(dns.addresses);
        if (!address)
            throw new Error(
                `${spec.name}: project DNS has no IPv6 address; Apple 1.5 networking is required`,
            );

        // IPv4 is available immediately at boot; SLAAC IPv6 becomes ready shortly afterwards.
        // Keep both so existing clients can resolve through stable IPv6 after DNS restarts.
        return { ...spec, dns: [...(ipv4 ? [ipv4] : []), address] };
    }

    private async collectScripts(
        task: NonNullable<ServiceSpec['initialization']>,
    ) {
        const scripts: string[] = [];
        const visit = async (directory: string) => {
            const entries = await readdir(directory, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name));

            for (const entry of entries) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) {
                    await visit(path);
                    continue;
                }

                if (!entry.isFile()) continue;
                if (!entry.name.endsWith(`.${task.suffix}.${task.extension}`))
                    continue;

                scripts.push(path);
            }
        };

        await visit(task.directory);
        return scripts;
    }

    private async taskDataIdentity(
        task: NonNullable<ServiceSpec['initialization']>,
        target: ObservedContainer,
        context: OperationContext,
    ) {
        const spec = this.project?.services[task.target];
        const storage = this.inner.containers.storageIdentity
            ? await this.inner.containers.storageIdentity(
                  target.id,
                  context.signal,
              )
            : {
                  volumes: target.anonymousVolumes,
                  mounts: spec?.mounts.filter((m) => !m.readOnly),
              };

        // Runtime mount lists may change order when containers are recreated.
        return {
            current: canonical(
                Array.isArray(storage)
                    ? [...storage].sort((a, b) =>
                          canonical(a).localeCompare(canonical(b)),
                      )
                    : storage,
            ),
            legacy: JSON.stringify(storage),
        };
    }

    private taskLog(context: OperationContext): TaskLog {
        const entries: string[] = [];
        let warnings = 0;

        const emit = (raw: string, stream: 'stdout' | 'stderr' = 'stdout') => {
            const text = safeLog(raw);
            entries.push(text);
            if (entries.length > 200) entries.shift();
            context.onOutput?.({ stream, text });
        };

        const warn = (
            path: string,
            checkpoint: InitializationCheckpoint,
            unchanged = false,
        ) => {
            warnings++;
            emit(
                `Warning: ${path}: ${unchanged ? 'unchanged script previously' : 'initialization'} exited ${checkpoint.exitCode}; ${unchanged ? 'skipping unchanged script' : 'continuing with remaining scripts'}.` +
                    (checkpoint.diagnostic ? ` ${checkpoint.diagnostic}` : ''),
                'stderr',
            );
        };

        return { emit, warn, count: () => warnings, lines: () => [...entries] };
    }

    private async runScript(path: string, run: ScriptRun) {
        const { container, task, target, identity, context, log, exec } = run;
        context.signal?.throwIfAborted();

        const bytes = await readFile(path);
        const encoded = bytes.toString('base64');
        const digest = hash(encoded + identity.current);
        const legacyDigest = hash(encoded + identity.legacy);

        const ledger = join(
            this.state,
            'initialization',
            hash(`${task.target}:${path}`) + '.json',
        );
        const previous = await optionalJson<InitializationCheckpoint>(ledger);
        if (
            await this.reuseCheckpoint(path, {
                previous,
                digest,
                legacyDigest,
                ledger,
                run,
            })
        )
            return;

        log.emit(`Initializing ${task.target}: ${path}`);
        const args =
            task.extension === 'js'
                ? ['mongosh', '--file', '/dev/stdin']
                : ['bash'];
        const result = await exec(target.id, args, context, bytes);
        context.signal?.throwIfAborted();

        const checkpoint: InitializationCheckpoint = {
            digest,
            exitCode: result.code,
        };
        if (result.code !== 0) {
            checkpoint.diagnostic = await this.scriptDiagnostic(run, result);
            log.warn(path, checkpoint);
        }

        // Match the script runner: remember completed attempts, including warnings.
        context.signal?.throwIfAborted();
        await privateJson(ledger, checkpoint);
    }

    private async reuseCheckpoint(
        path: string,
        input: {
            previous?: InitializationCheckpoint;
            digest: string;
            legacyDigest: string;
            ledger: string;
            run: ScriptRun;
        },
    ) {
        const { previous, digest, legacyDigest, ledger, run } = input;
        if (
            run.task.force ||
            !previous ||
            ![digest, legacyDigest].includes(previous.digest)
        )
            return false;

        if (previous.digest !== digest)
            await privateJson(ledger, { ...previous, digest });

        if (previous.exitCode) run.log.warn(path, previous, true);
        else run.log.emit(`Unchanged: ${path}`);
        return true;
    }

    private async scriptDiagnostic(
        run: ScriptRun,
        result: Awaited<ReturnType<TaskExec>>,
    ) {
        const { target, task, container, context } = run;
        const current = await this.inner.containers.inspectOwned(
            target.id,
            context.signal,
        );
        if (
            current.lifecycle !== 'running' ||
            current.incarnation !== target.incarnation
        )
            throw new Error(
                `${container.service}: target ${task.target} stopped or changed during initialization`,
            );

        const diagnostic = result.stderr.trim() || result.stdout.trim();
        return safeLog(diagnostic, [], diagnostic.length)
            .slice(-1000)
            .replace(/\s+/g, ' ');
    }

    private async taskTarget(
        task: ServiceSpec['initialization'],
        service: string,
        context: OperationContext,
    ) {
        const target = (await this.inner.containers.list(context.signal)).find(
            (entry) => entry.service === task!.target,
        );
        if (!target || target.lifecycle !== 'running')
            throw new Error(
                `${service}: target ${task!.target} is not running`,
            );

        const exec = this.inner.containers.exec;
        if (!exec)
            throw new Error(
                'Runtime does not support initialization execution',
            );

        return { target, exec };
    }

    private async executeTask(
        container: ObservedContainer,
        context: OperationContext,
    ) {
        const record = await this.task(container.id),
            task = record.initialization;
        if (record.container.incarnation !== container.incarnation)
            throw new Error('Initialization task changed');

        const { target, exec } = await this.taskTarget(
            task,
            container.service,
            context,
        );
        const scripts = await this.collectScripts(task);

        record.container.lifecycle = 'running';
        record.container.exitCode = undefined;
        record.logs = [];
        await privateJson(this.taskPath(container.id), record);

        const log = this.taskLog(context);
        try {
            const identity = await this.taskDataIdentity(task, target, context);
            const run: ScriptRun = {
                container,
                task,
                target,
                identity,
                context,
                log,
                exec,
            };

            for (const path of scripts) await this.runScript(path, run);
            context.signal?.throwIfAborted();

            record.container.exitCode = 0;
            const warnings = log.count();
            log.emit(
                warnings
                    ? `Warning: Initialization completed with warnings: ${container.service} (${warnings} of ${scripts.length} scripts). Some initialization may be incomplete. Change the affected scripts or set FORCE_RUN to retry them.`
                    : `Initialization completed: ${container.service} (${scripts.length} scripts)`,
                warnings ? 'stderr' : 'stdout',
            );
        } catch (error) {
            record.container.exitCode = 1;
            log.emit(error instanceof Error ? error.message : String(error));
            throw error;
        } finally {
            record.container.lifecycle = 'exited';
            record.logs = log.lines();
            await privateJson(this.taskPath(container.id), record);
        }
    }

    private async validateRouting(project: ResolvedProject) {
        for (const spec of Object.values(project.services))
            for (const key of Object.keys(spec.labels).filter((k) =>
                k.startsWith('traefik.'),
            ))
                if (
                    !/^traefik\.http\.(routers\.[^.]+\.(rule|priority|ruleSyntax|middlewares|service)|services\.[^.]+\.loadbalancer\.server\.port|middlewares\.[^.]+\.headers\.accessControlAllowOriginList)$/.test(
                        key,
                    ) &&
                    key !== 'traefik.enable'
                )
                    throw new LiveFailure(
                        `${spec.source}: ${spec.name}: unsupported native routing label ${key}`,
                        'blocked',
                    );
    }

    private addDnsDependencies(project: ResolvedProject) {
        for (const spec of Object.values(project.services)) {
            if (spec.initialization) continue;

            spec.dependencies['chs-dns'] = {
                condition: 'service_started',
                restart: true,
                required: true,
            };

            if (
                spec.name !== 'ingress-proxy' &&
                spec.extraHosts.some((h) => h.endsWith(':host-gateway')) &&
                project.services['ingress-proxy']
            )
                spec.dependencies['ingress-proxy'] = {
                    condition: 'service_started',
                    restart: false,
                    required: true,
                };
        }
    }

    private configureDns(project: ResolvedProject) {
        if (project.services['chs-dns']) {
            if (project.services['chs-dns'].source !== 'CHS project DNS')
                throw new LiveFailure(
                    'chs-dns is reserved for native Apple service discovery.',
                    'blocked',
                );
            return;
        }

        const network = Object.keys(project.networks)[0];
        if (!network) throw new Error('Apple requires a project network');

        const upstreams = [
            ...new Set(
                Object.values(project.services)
                    .filter((s) => runtimeService(s) && s.dns.length)
                    .map((s) => s.dns.join(' ')),
            ),
        ];
        if (upstreams.length > 1)
            throw new LiveFailure(
                'Conflicting per-service DNS overrides are unsupported on Apple.',
                'blocked',
            );

        this.addDnsDependencies(project);
        project.services['chs-dns'] = {
            name: 'chs-dns',
            source: 'CHS project DNS',
            owner: 'ingress-proxy',
            mode: 'Service',
            kind: 'service',
            image: 'coredns/coredns:1.12.3',
            pullPolicy: 'missing',
            command: ['-conf', '/etc/chs-dns/Corefile'],
            environment: {},
            labels: {
                'chs.dev.role': 'dns',
                'chs.dev.dns-upstreams': upstreams[0] ?? '',
            },
            mounts: [
                {
                    type: 'bind',
                    source: join(this.state, 'discovery', 'dns'),
                    target: '/etc/chs-dns',
                    readOnly: true,
                    createHostPath: true,
                },
            ],
            ports: [],
            expose: ['53/udp', '53/tcp'],
            networks: { [network]: { aliases: ['chs-dns'] } },
            aliases: ['chs-dns'],
            dns: [],
            dnsSearch: [],
            extraHosts: [],
            restart: 'unless-stopped',
            stopSeconds: 10,
            dependencies: {},
            memory: 256 * 1024 * 1024,
        };
        project.services['chs-dns'].user = '0';
    }

    private async saveDiscoveryModel(project: ResolvedProject) {
        // Only discovery inputs are persisted; resolved environment and command credentials stay in memory.
        await privateJson(join(this.state, 'discovery-model.json'), {
            identity: project.identity,
            directory: project.directory,
            namespace: project.namespace,
            services: Object.fromEntries(
                Object.entries(project.services)
                    .filter(([, spec]) => runtimeService(spec))
                    .map(([name, spec]) => [name, discoveryServiceModel(spec)]),
            ),
        });
    }

    publish(context: OperationContext) {
        const work = this.publishQueue
            .catch(() => {})
            .then(() => this.publishNow(context));
        this.publishQueue = work;
        return work;
    }

    private runningService(observed: ObservedContainer[], name: string) {
        const c = observed.find(
            (c) => c.service === name && c.lifecycle === 'running',
        );
        return { container: c, ip: c && firstAddress(c.addresses) };
    }

    private collectDiscovery(
        model: ResolvedProject,
        observed: ObservedContainer[],
        http: DiscoveryHttp,
        targets: DiscoveryTarget[],
    ) {
        for (const [name, spec] of Object.entries(model.services)) {
            const { container: c, ip } = this.runningService(observed, name);
            if (
                !ip ||
                c?.health === 'unhealthy' ||
                spec.labels['traefik.enable'] === 'false'
            )
                continue;

            const backend = this.routing(name, spec, ip, http);
            this.applyDefaultRouterService(spec, backend, http);
            this.collectTargets(name, spec, ip, model.identity, targets);
        }
    }

    private async publishNow(context: OperationContext) {
        const model = await optionalJson<ResolvedProject>(
            join(this.state, 'discovery-model.json'),
        );
        if (!model) return;

        const observed = await this.inner.containers.list(context.signal);
        const proxy = observed.find(
            (c) => c.service === 'ingress-proxy' && c.lifecycle === 'running',
        );
        const proxyAddress = proxy && firstAddress(proxy.addresses);

        // Docker resolves network aliases and per-container extra_hosts itself.
        // Only Apple uses the generated project-wide DNS records below.
        const records = this.apple
            ? this.projectDnsRecords(model, observed, proxyAddress)
            : new Map<string, string>();
        const targets: DiscoveryTarget[] = [];
        const http: DiscoveryHttp = {
            routers: Object.create(null),
            services: Object.create(null),
            middlewares: Object.create(null),
        };

        this.collectDiscovery(model, observed, http, targets);
        const contents = this.discoveryContents(http, targets, records);
        const digest = hash(JSON.stringify(contents));
        if (digest === this.appliedDiscovery) return;

        await this.writeDiscovery('routes', 'routes.yaml', contents.routes);
        await this.writeDiscovery('targets', 'targets.json', contents.targets);

        if (this.apple) {
            const upstream =
                model.services['chs-dns']?.labels['chs.dev.dns-upstreams'] ||
                '/etc/resolv.conf';
            await this.writeDiscovery('dns', 'hosts', contents.hosts);
            await this.writeDiscovery(
                'dns',
                'Corefile',
                `.:53 .:1053 {\n hosts /etc/chs-dns/hosts {\n ttl 2\n reload 1s\n fallthrough\n }\n forward . ${upstream}\n errors\n}\n`,
            );
            await this.verifyDns(observed, records, context);
            await this.reloadAppleIngress(proxy, context);
        }

        this.appliedDiscovery = digest;
    }

    private addExtraHosts(
        spec: ServiceSpec,
        proxyAddress: string | undefined,
        add: (name: string, address: string) => void,
    ) {
        for (const host of spec.extraHosts) {
            const split = host.indexOf(':'),
                name = host.slice(0, split),
                address = host.slice(split + 1);
            if (address === 'host-gateway') {
                if (proxyAddress) add(name, proxyAddress);
            } else add(name, address);
        }
    }

    private projectDnsRecords(
        model: ResolvedProject,
        observed: ObservedContainer[],
        proxyAddress?: string,
    ) {
        const records = new Map<string, string>();
        const add = (name: string, address: string) => {
            if (!/^[a-zA-Z0-9_.-]+$/.test(name) || /[\s#]/.test(address))
                throw new Error('Invalid DNS record');
            if (records.has(name) && records.get(name) !== address)
                throw new LiveFailure(
                    `Conflicting project DNS alias ${name}`,
                    'blocked',
                );

            records.set(name, address);
        };

        for (const [name, spec] of Object.entries(model.services)) {
            const c = observed.find(
                    (c) => c.service === name && c.lifecycle === 'running',
                ),
                ip = c && firstAddress(c.addresses);
            if (ip) {
                for (const alias of new Set([
                    ...spec.aliases,
                    ...networkAliases(spec),
                ]))
                    add(alias, ip);
            }

            this.addExtraHosts(spec, proxyAddress, add);
        }

        return records;
    }

    private routing(
        name: string,
        spec: ServiceSpec,
        ip: string,
        http: DiscoveryHttp,
    ): string | undefined {
        let backend: string | undefined;

        for (const [key, value] of Object.entries(spec.labels)) {
            const service =
                /^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/.exec(
                    key,
                );
            if (service) {
                if (!/^\d+$/.test(value))
                    throw new Error(`${name}: invalid routing port`);

                backend = service[1];
                const url = `http://${this.apple ? ip : name}:${value}`;
                http.services[backend] = {
                    loadBalancer: {
                        servers: [{ url }],
                    },
                };
                continue;
            }

            const router =
                /^traefik\.http\.routers\.([^.]+)\.(rule|priority|ruleSyntax|middlewares|service)$/.exec(
                    key,
                );
            if (router) {
                const r = (http.routers[router[1]] ??= {});
                Object.assign(r, routerProperty(router[2], value));
                continue;
            }

            const middleware =
                /^traefik\.http\.middlewares\.([^.]+)\.headers\.accessControlAllowOriginList$/.exec(
                    key,
                );
            if (!middleware) continue;

            http.middlewares[middleware[1]] = {
                headers: {
                    accessControlAllowOriginList: value.split(','),
                },
            };
        }

        return backend;
    }

    private applyDefaultRouterService(
        spec: ServiceSpec,
        backend: string | undefined,
        http: DiscoveryHttp,
    ) {
        if (!backend) return;

        for (const key of Object.keys(spec.labels)) {
            const r = /^traefik\.http\.routers\.([^.]+)\./.exec(key);
            if (r) http.routers[r[1]].service ??= backend;
        }
    }

    private collectTargets(
        name: string,
        spec: ServiceSpec,
        ip: string,
        identity: string,
        targets: DiscoveryTarget[],
    ) {
        for (const port of new Set([
            ...spec.expose.map((p) => p.split('/')[0]),
            ...spec.ports
                .filter((p) => p.protocol === 'tcp')
                .map((p) => String(p.target)),
        ]))
            targets.push({
                targets: [`${ip}:${port}`],
                labels: { chs_service: name, chs_project: identity },
            });
    }

    private discoveryContents(
        http: DiscoveryHttp,
        targets: DiscoveryTarget[],
        records: Map<string, string>,
    ) {
        const populated = Object.fromEntries(
            Object.entries(http).filter(([, v]) => Object.keys(v).length),
        );
        return {
            routes: stringify(
                Object.keys(populated).length ? { http: populated } : {},
            ),
            targets: JSON.stringify(targets),
            hosts:
                [...records].map(([name, ip]) => `${ip} ${name}`).join('\n') +
                '\n',
        };
    }

    private async writeDiscovery(
        directory: string,
        name: string,
        text: string,
    ) {
        const dir = join(this.state, 'discovery', directory);
        await mkdir(dir, { recursive: true, mode: 0o755 });
        await chmod(dir, 0o755);

        const file = join(dir, name);
        if ((await readFile(file, 'utf8').catch(() => undefined)) === text)
            return;

        // VirtioFS consumers can retain the old inode after host-side rename.
        // DNS publication is acknowledged by querying the resolver before dependencies start.
        if (this.apple && directory === 'dns') {
            await writeFile(file, text, { mode: 0o644 });
            return;
        }

        const temp = join(dir, `.${name}.${randomUUID()}`);
        await writeFile(temp, text, { mode: 0o644 });
        await rename(temp, file);
    }

    private async verifyDns(
        observed: ObservedContainer[],
        records: Map<string, string>,
        context: OperationContext,
    ) {
        const dns = observed.find(
            (c) => c.service === 'chs-dns' && c.lifecycle === 'running',
        );
        const dnsAddress = dns && firstAddress(dns.addresses);
        if (!dnsAddress) return;

        const resolver = new Resolver({ timeout: 500, tries: 1 });
        resolver.setServers([`${dnsAddress}:1053`]);
        const cancel = () => resolver.cancel();
        context.signal?.addEventListener('abort', cancel, { once: true });

        try {
            for (const [name, address] of records) {
                if (this.dnsRecords.get(name) === address) continue;

                await waitForDnsRecord(resolver, name, address, context.signal);
            }
            this.dnsRecords = records;
        } finally {
            context.signal?.removeEventListener('abort', cancel);
            resolver.cancel();
        }
    }

    private async reloadAppleIngress(
        proxy: ObservedContainer | undefined,
        context: OperationContext,
    ) {
        // Generate the filesystem event in the guest, where Traefik's watcher runs.
        if (!proxy || !this.inner.containers.exec) return;

        const result = await this.inner.containers.exec(
            proxy.id,
            [
                '/bin/sh',
                '-c',
                'cp /etc/chs-routing/routes.yaml /etc/chs-routing/.next && mv /etc/chs-routing/.next /etc/chs-routing/routes.yaml',
            ],
            context,
        );
        if (result.code !== 0)
            throw new Error('Cannot publish Apple ingress configuration');
    }

    async monitor(context: OperationContext) {
        await this.inner.monitor?.(context);
        await this.publish(context);
    }

    async probe(context: OperationContext) {
        await this.inner.probe?.(context);
    }

    async close() {
        await this.publishQueue.catch(() => {});
        await this.inner.close?.();
    }
}
