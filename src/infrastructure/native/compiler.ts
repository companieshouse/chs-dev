import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import type { PreparedProject } from '../../domain/live.js';
import { LiveFailure } from '../../domain/live.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';
import type {
    ResolvedProject,
    ServiceSpec,
    ResourceSpec,
} from '../../domain/orchestration.js';
import { dependencyOrder } from '../../domain/orchestration.js';
import type { ProcessExecutor } from '../live-process.js';
import { composeArguments } from '../live-runtime.js';

export interface CompilationContext extends OperationContext {
    environment: NodeJS.ProcessEnv;
}
export interface DefinitionCompiler {
    checkAvailability?(context: CompilationContext): Promise<void>;
    compile(
        project: PreparedProject,
        context: CompilationContext,
    ): Promise<ResolvedProject>;
}
export function namespace(directory: string) {
    return `chs-native-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`;
}

const fields = new Set(
    'image build command entrypoint environment env_file labels user working_dir hostname volumes ports expose networks dns dns_search extra_hosts mem_limit mem_reservation restart stop_signal stop_grace_period healthcheck depends_on platform pull_policy container_name develop'.split(
        ' ',
    ),
);
function allowed(value: any, keys: string[], where: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${where}: expected a mapping`);
    for (const key of Object.keys(value))
        if (!keys.includes(key) && !key.startsWith('x-'))
            throw new Error(`${where}: unsupported field ${key}`);
}
export function duration(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number') return value;
    const text = String(value);
    let total = 0;
    let consumed = '';
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)) {
        consumed += match[0];
        total +=
            Number(match[1]) *
            { ns: 1, us: 1e3, µs: 1e3, ms: 1e6, s: 1e9, m: 60e9, h: 3600e9 }[
                match[2]
            ]!;
    }
    if (consumed !== text) throw new Error(`Invalid duration ${text}`);
    return Math.round(total);
}
function memory(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number') return value;
    const m = /^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i.exec(String(value));
    if (!m) throw new Error(`Unsupported memory value ${value}`);
    return Math.round(
        Number(m[1]) *
            1024 ** Math.max(0, 'bkmg'.indexOf((m[2] ?? 'b').toLowerCase())),
    );
}
function command(value: unknown, where: string): string[] | null | undefined {
    if (value === undefined || value === null) return value;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        throw new Error(`${where}: compiler must provide an argument array`);
    return value;
}
function parseHostEntry(
    entry: unknown,
    invalid: () => Error,
): [string, unknown] {
    if (typeof entry !== 'string') throw invalid();
    const separator = entry.includes('=')
        ? entry.indexOf('=')
        : entry.indexOf(':');
    if (separator < 1) throw invalid();
    return [entry.slice(0, separator), entry.slice(separator + 1)];
}
function hostEntries(
    value: unknown,
    invalid: () => Error,
): [string, unknown][] {
    if (Array.isArray(value))
        return value.map((entry) => parseHostEntry(entry, invalid));
    if (!value || typeof value !== 'object') throw invalid();
    return Object.entries(value).flatMap(([host, addresses]) =>
        (Array.isArray(addresses) ? addresses : [addresses]).map(
            (address): [string, unknown] => [host, address],
        ),
    );
}
function extraHosts(value: unknown, where: string): string[] {
    if (value === undefined || value === null) return [];
    const invalid = () =>
        new Error(
            `${where}.extra_hosts: expected hostname=IP or hostname:IP entries (IPv4, IPv6 or host-gateway), or a hostname-to-address mapping.`,
        );
    const entries = hostEntries(value, invalid);
    return entries.map(([host, value]) => {
        if (!host || /[\s:=]/.test(host) || typeof value !== 'string')
            throw invalid();
        const address = value.replace(/^\[(.*)\]$/, '$1');
        if (address !== 'host-gateway' && !isIP(address)) throw invalid();
        return `${host}:${address}`;
    });
}
function resourceMap(input: any, kind: string): Record<string, ResourceSpec> {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([name, raw]) => {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name))
                throw new Error(`Invalid ${kind} name`);
            const value = raw ?? {};
            allowed(
                value,
                ['name', 'driver', 'driver_opts', 'labels', 'internal', 'ipam'],
                `${kind}.${name}`,
            );
            if ((value as any).ipam && Object.keys((value as any).ipam).length)
                throw new Error(`${kind}.${name}: custom IPAM is unsupported`);
            return [
                name,
                {
                    driver: (value as any).driver,
                    options: (value as any).driver_opts,
                    labels: (value as any).labels,
                    internal: (value as any).internal,
                },
            ];
        }),
    );
}

/** Collects services that any service waits on to completion. */
function completedJobs(document: any): Set<string> {
    const jobs = new Set<string>();
    for (const spec of Object.values(document.services ?? {}) as any[])
        for (const [dep, rule] of Object.entries(spec.depends_on ?? {}) as [
            string,
            any,
        ][])
            if (rule.condition === 'service_completed_successfully')
                jobs.add(dep);
    return jobs;
}

function serviceKind(name: string, owner: string, jobs: Set<string>) {
    return jobs.has(name) ||
        /^execute-.*-scripts$/.test(name) ||
        name === 'init' ||
        owner !== name
        ? 'job'
        : 'service';
}

function serviceSpec(
    name: string,
    raw: any,
    source: string,
    where: string,
    jobs: Set<string>,
): ServiceSpec {
    const owner = raw.labels?.['chs.dev.owner-service'] ?? name;
    return {
        name,
        source,
        owner,
        mode: raw.labels?.['chs.dev.mode'] ?? 'Service',
        kind: serviceKind(name, owner, jobs),
        image: raw.image,
        platform: raw.platform,
        pullPolicy: raw.pull_policy ?? 'missing',
        command: command(raw.command, where),
        entrypoint: command(raw.entrypoint, where),
        environment: Object.fromEntries(
            Object.entries(raw.environment ?? {})
                .filter(([, v]) => v !== null)
                .map(([k, v]) => [k, String(v)]),
        ),
        labels: raw.labels ?? {},
        user: raw.user,
        workingDir: raw.working_dir,
        hostname: raw.hostname,
        aliases: [name, raw.container_name].filter(Boolean),
        mounts: [],
        ports: [],
        ...serviceRuntimePolicies(raw, where),
        networks: {},
        dependencies: {},
    };
}

function serviceRuntimePolicies(raw: any, where: string) {
    return {
        expose: (raw.expose ?? []).map(String),
        dns: raw.dns ?? [],
        dnsSearch: raw.dns_search ?? [],
        extraHosts: extraHosts(raw.extra_hosts, where),
        memory: memory(raw.mem_limit),
        memoryReservation: memory(raw.mem_reservation),
        restart: raw.restart ?? 'no',
        stopSignal: raw.stop_signal,
        stopSeconds: (duration(raw.stop_grace_period) ?? 10e9) / 1e9,
    };
}

function validatePolicies(spec: ServiceSpec, where: string) {
    if (!['missing', 'always', 'never', 'build'].includes(spec.pullPolicy))
        throw new Error(`${where}: unsupported pull_policy`);
    if (!/^(no|always|unless-stopped|on-failure(?::\d+)?)$/.test(spec.restart))
        throw new Error(`${where}: unsupported restart policy`);
}

function applyBuild(spec: ServiceSpec, raw: any, where: string) {
    if (!raw.build) return;
    allowed(
        raw.build,
        ['context', 'dockerfile', 'args', 'target'],
        `${where}.build`,
    );
    spec.build = {
        context: raw.build.context,
        dockerfile: raw.build.dockerfile,
        args: Object.fromEntries(
            Object.entries(raw.build.args ?? {})
                .filter(([, v]) => v !== null)
                .map(([k, v]) => [k, String(v)]),
        ),
        target: raw.build.target,
    };
}

function applyHealthcheck(spec: ServiceSpec, raw: any, where: string) {
    if (!raw.healthcheck) return;
    const h = raw.healthcheck;
    allowed(
        h,
        [
            'test',
            'disable',
            'interval',
            'timeout',
            'retries',
            'start_period',
            'start_interval',
        ],
        `${where}.healthcheck`,
    );
    spec.health = {
        test: h.disable ? ['NONE'] : h.test,
        interval: duration(h.interval),
        timeout: duration(h.timeout),
        retries: h.retries,
        startPeriod: duration(h.start_period),
        startInterval: duration(h.start_interval),
    };
}

function applyDependencies(spec: ServiceSpec, raw: any, where: string) {
    for (const [dep, rule] of Object.entries(raw.depends_on ?? {}) as [
        string,
        any,
    ][]) {
        allowed(
            rule,
            ['condition', 'restart', 'required'],
            `${where}.depends_on.${dep}`,
        );
        if (
            ![
                'service_started',
                'service_healthy',
                'service_completed_successfully',
            ].includes(rule.condition)
        )
            throw new Error(`${where}: unsupported dependency condition`);
        spec.dependencies[dep] = {
            condition: rule.condition,
            restart: rule.restart ?? false,
            required: rule.required ?? true,
        };
    }
}

function applyNetworks(
    spec: ServiceSpec,
    raw: any,
    result: ResolvedProject,
    where: string,
) {
    for (const [net, opts] of Object.entries(
        raw.networks ?? { default: null },
    ) as [string, any][]) {
        if (opts) allowed(opts, ['aliases'], `${where}.networks.${net}`);
        if (!result.networks[net]) result.networks[net] = {};
        spec.networks[net] = {
            aliases: [...new Set([...spec.aliases, ...(opts?.aliases ?? [])])],
        };
    }
}

function validateMount(mount: any, where: string) {
    allowed(
        mount,
        [
            'type',
            'source',
            'target',
            'read_only',
            'bind',
            'volume',
            'tmpfs',
            'consistency',
        ],
        `${where}.volumes`,
    );
    if (!['bind', 'volume', 'tmpfs'].includes(mount.type))
        throw new Error(`${where}: unsupported mount type`);
    if (mount.bind)
        allowed(mount.bind, ['create_host_path'], `${where}.volumes.bind`);
    if (mount.volume && Object.keys(mount.volume).length)
        throw new Error(`${where}: unsupported volume options`);
    if (mount.tmpfs || mount.consistency)
        throw new Error(`${where}: unsupported mount options`);
}

function applyMounts(spec: ServiceSpec, raw: any, where: string) {
    for (const mount of raw.volumes ?? []) {
        validateMount(mount, where);
        spec.mounts.push({
            type: mount.type,
            source: mount.source,
            target: mount.target,
            readOnly: mount.read_only ?? false,
            createHostPath: mount.bind?.create_host_path,
        });
    }
}

function fileResourceTarget(
    ref: { target?: string; source: string },
    kind: string,
) {
    if (ref.target?.startsWith('/')) return ref.target;
    const name = ref.target ?? ref.source;
    return kind === 'secrets' ? `/run/secrets/${name}` : `/${name}`;
}

function applyFileResources(
    document: any,
    spec: ServiceSpec,
    raw: any,
    where: string,
) {
    for (const kind of ['secrets', 'configs'])
        for (const ref of raw[kind] ?? []) {
            allowed(ref, ['source', 'target'], `${where}.${kind}`);
            const resource = document[kind]?.[ref.source];
            if (!resource?.file)
                throw new Error(
                    `${where}: only file-backed ${kind} are supported`,
                );
            allowed(
                resource,
                ['file', 'name'],
                `${where}.${kind}.${ref.source}`,
            );
            spec.mounts.push({
                type: 'bind',
                source: resource.file,
                target: fileResourceTarget(ref, kind),
                readOnly: true,
            });
        }
}

function validatePort(port: any, where: string) {
    allowed(
        port,
        ['target', 'published', 'host_ip', 'protocol', 'mode'],
        `${where}.ports`,
    );
    if (port.mode && port.mode !== 'ingress')
        throw new Error(`${where}: unsupported port mode`);
    if (
        !Number.isInteger(Number(port.target)) ||
        Number(port.target) < 1 ||
        Number(port.target) > 65535 ||
        (port.published && !/^\d+$/.test(port.published))
    )
        throw new Error(
            `${where}: native ports require individual numeric ports`,
        );
}

function applyPorts(spec: ServiceSpec, raw: any, where: string) {
    for (const port of raw.ports ?? []) {
        validatePort(port, where);
        spec.ports.push({
            target: Number(port.target),
            published: port.published,
            hostIp: port.host_ip,
            protocol: port.protocol ?? 'tcp',
        });
    }
}

function validateDevelopWatch(raw: any, where: string) {
    if (!raw.develop) return;
    allowed(raw.develop, ['watch'], `${where}.develop`);
    for (const watch of raw.develop.watch ?? [])
        if (
            watch.action !== 'rebuild' ||
            !String(watch.path).endsWith('/.touch')
        )
            throw new Error(
                `${where}: only legacy Reload watch metadata is supported`,
            );
}

/** Everything translateService needs from the surrounding project translation. */
interface TranslateScope {
    document: any;
    prepared: PreparedProject;
    jobs: Set<string>;
    result: ResolvedProject;
}

function translateService(
    scope: TranslateScope,
    name: string,
    raw: any,
): ServiceSpec {
    const { document, prepared, jobs, result } = scope;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name))
        throw new Error('Invalid service name');
    const source = prepared.sources?.[name] ?? prepared.composeFiles[0];
    const where = `${source}: ${name}`;
    allowed(raw, [...fields, 'secrets', 'configs'], where);
    if (
        Object.keys(raw.labels ?? {}).some((label) =>
            label.startsWith('com.docker.compose.'),
        )
    )
        throw new Error(
            `${where}: reserved Compose ownership labels are unsupported`,
        );
    const spec = serviceSpec(name, raw, source, where, jobs);
    validatePolicies(spec, where);
    applyBuild(spec, raw, where);
    if (!spec.image && !spec.build)
        throw new Error(`${where}: image or build required`);
    applyHealthcheck(spec, raw, where);
    applyDependencies(spec, raw, where);
    applyNetworks(spec, raw, result, where);
    applyMounts(spec, raw, where);
    applyFileResources(document, spec, raw, where);
    applyPorts(spec, raw, where);
    validateDevelopWatch(raw, where);
    return spec;
}

/** Input is normalized compiler output; the scheduler never sees Compose syntax. */
export function translate(
    document: any,
    prepared: PreparedProject,
): ResolvedProject {
    allowed(
        document,
        [
            'name',
            'services',
            'networks',
            'volumes',
            'secrets',
            'configs',
            'version',
        ],
        'project',
    );
    const result: ResolvedProject = {
        identity: prepared.projectName,
        directory: prepared.projectDirectory,
        namespace: namespace(prepared.projectDirectory),
        services: {},
        networks: resourceMap(document.networks, 'networks'),
        volumes: resourceMap(document.volumes, 'volumes'),
    };
    const jobs = completedJobs(document);
    const scope: TranslateScope = { document, prepared, jobs, result };
    for (const [name, raw] of Object.entries(document.services ?? {}) as [
        string,
        any,
    ][])
        result.services[name] = translateService(scope, name, raw);
    dependencyOrder(result.services);
    return result;
}

export class ComposeDefinitionCompiler implements DefinitionCompiler {
    constructor(private readonly execute: ProcessExecutor) {}
    async checkAvailability(context: CompilationContext) {
        const response = await this.execute({
            command: 'docker',
            args: ['compose', 'version', '--short'],
            cwd: process.cwd(),
            env: context.environment,
            signal: context.signal,
            captureStdout: true,
            privateOutput: true,
        });
        if (response.code !== 0)
            throw new LiveFailure(
                'Docker Compose configuration compiler is unavailable.',
                'blocked',
            );
    }
    async compile(project: PreparedProject, context: CompilationContext) {
        const response = await this.execute({
            command: 'docker',
            args: [...composeArguments(project), 'config', '--format', 'json'],
            cwd: project.projectDirectory,
            env: context.environment,
            signal: context.signal,
            captureStdout: true,
            privateOutput: true,
        });
        if (response.code !== 0)
            throw new LiveFailure(
                'Compose configuration compilation failed. Validate the project definitions and required environment; resolved output was withheld to protect credentials.',
                'blocked',
            );
        try {
            return translate(JSON.parse(response.stdout), project);
        } catch (error) {
            throw new LiveFailure(
                error instanceof SyntaxError
                    ? 'Invalid compiler JSON output'
                    : String(error instanceof Error ? error.message : error),
                'blocked',
            );
        }
    }
}
