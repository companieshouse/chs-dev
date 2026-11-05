import { request, type IncomingMessage } from 'node:http';
import type { ProcessExecutor } from '../live-process.js';
import type { CompilationContext } from './compiler.js';
import type {
    ResolvedProject,
    ServiceSpec,
} from '../../domain/orchestration.js';
import { LiveFailure } from '../../domain/live.js';

export class DockerError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly detail?: string,
    ) {
        super(message);
    }
}
export interface DockerConnection {
    socket: string;
    environment: NodeJS.ProcessEnv;
}
export async function resolveDockerConnection(
    execute: ProcessExecutor,
    directory: string,
    environment: NodeJS.ProcessEnv,
    signal?: AbortSignal,
): Promise<DockerConnection> {
    let host = environment.DOCKER_CONTEXT ? undefined : environment.DOCKER_HOST;
    if (!host) {
        const result = await execute({
            command: 'docker',
            args: [
                'context',
                'inspect',
                ...(environment.DOCKER_CONTEXT
                    ? [environment.DOCKER_CONTEXT]
                    : []),
            ],
            cwd: directory,
            env: environment,
            signal,
            captureStdout: true,
            privateOutput: true,
        });
        if (result.code !== 0)
            throw new LiveFailure('Cannot resolve Docker context.', 'blocked');
        host = JSON.parse(result.stdout)[0]?.Endpoints?.docker?.Host;
    }
    if (!host?.startsWith('unix://'))
        throw new LiveFailure(
            'Native Docker requires a local Unix-socket endpoint. Select Compose for remote Docker contexts.',
            'blocked',
        );
    const pinned: NodeJS.ProcessEnv = { ...environment, DOCKER_HOST: host };
    delete pinned.DOCKER_CONTEXT;
    return { socket: host.slice(7), environment: pinned };
}
export interface DockerApi {
    call<T = any>(
        method: string,
        path: string,
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<T>;
    logs(id: string, tail: number, signal?: AbortSignal): Promise<string[]>;
}
export class DockerHttpClient implements DockerApi {
    private version = '';
    private static errorDetail(bytes: Buffer) {
        const text = bytes.toString('utf8').trim();
        if (!text) return '';
        let detail = text;
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed?.message === 'string') detail = parsed.message;
            else detail = '';
        } catch {
            // Docker can return plain-text errors for some daemon failures.
        }
        return detail.replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
    }
    private readResponse(
        res: IncomingMessage,
        request: { method: string; path: string },
        completion: {
            resolve(value: Buffer): void;
            reject(error: Error): void;
        },
        cancel: (error: Error) => void,
    ) {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 16 * 1024 * 1024)
                cancel(new Error('Docker response exceeded 16 MiB'));
            else chunks.push(chunk);
        });
        res.on('error', completion.reject);
        res.on('end', () =>
            this.completeResponse(
                res.statusCode,
                Buffer.concat(chunks),
                request,
                completion,
            ),
        );
    }
    private completeResponse(
        status: number | undefined,
        result: Buffer,
        request: { method: string; path: string },
        completion: {
            resolve(value: Buffer): void;
            reject(error: Error): void;
        },
    ) {
        if ((status ?? 500) < 400) {
            completion.resolve(result);
            return;
        }
        const detail = DockerHttpClient.errorDetail(result);
        completion.reject(
            new DockerError(
                status!,
                `Docker ${request.method} ${request.path.split('?')[0]} failed (HTTP ${status})${detail ? `: ${detail}` : '.'}`,
                detail,
            ),
        );
    }
    constructor(readonly socket: string) {}
    private async bytes(
        method: string,
        path: string,
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<Buffer> {
        signal?.throwIfAborted();
        return new Promise((resolve, reject) => {
            const payload =
                body === undefined ? undefined : JSON.stringify(body);
            const req = request(
                {
                    socketPath: this.socket,
                    path: `${this.version}${path}`,
                    method,
                    signal,
                    headers: payload
                        ? {
                              'Content-Type': 'application/json',
                              'Content-Length': Buffer.byteLength(payload),
                          }
                        : {},
                },
                (res) =>
                    this.readResponse(
                        res,
                        { method, path },
                        { resolve, reject },
                        (error) => req.destroy(error),
                    ),
            );
            const stopSeconds = Number(
                new URL('http://docker' + path).searchParams.get('t') ?? 0,
            );
            req.setTimeout(Math.max(65000, (stopSeconds + 5) * 1000), () =>
                req.destroy(new Error('Docker request timed out')),
            );
            req.on('error', reject);
            req.end(payload);
        });
    }
    async negotiate(signal?: AbortSignal, forced?: string) {
        const server = await this.call('GET', '/version', undefined, signal);
        const lower = Math.max(
            44,
            Number(String(server.MinAPIVersion ?? '1.24').split('.')[1]),
        );
        const upper = Math.min(
            47,
            Number(String(server.ApiVersion).split('.')[1]),
        );
        const version = forced ? Number(forced.split('.')[1]) : upper;
        if (
            lower > upper ||
            version < lower ||
            version > upper ||
            (forced && !/^1\.\d+$/.test(forced))
        )
            throw new LiveFailure(
                'Docker API compatibility requires a shared version in 1.44–1.47.',
                'blocked',
            );
        this.version = `/v1.${version}`;
    }
    async call<T = any>(
        method: string,
        path: string,
        body?: unknown,
        signal?: AbortSignal,
    ): Promise<T> {
        const bytes = await this.bytes(method, path, body, signal);
        return (bytes.length ? JSON.parse(bytes.toString()) : undefined) as T;
    }
    async logs(id: string, tail: number, signal?: AbortSignal) {
        return decodeLogs(
            await this.bytes(
                'GET',
                `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&timestamps=true&tail=${Math.max(1, Math.min(2000, tail))}`,
                undefined,
                signal,
            ),
        );
    }
}
export function decodeLogs(buffer: Buffer): string[] {
    let offset = 0;
    const chunks: Buffer[] = [];
    while (
        offset + 8 <= buffer.length &&
        buffer[offset] <= 2 &&
        buffer[offset + 1] === 0 &&
        buffer[offset + 2] === 0 &&
        buffer[offset + 3] === 0
    ) {
        const length = buffer.readUInt32BE(offset + 4);
        if (offset + 8 + length > buffer.length)
            throw new Error('Truncated Docker log frame');
        chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
        offset += 8 + length;
    }
    if (offset === 0) return buffer.toString().split(/\r?\n/).filter(Boolean);
    if (offset !== buffer.length) throw new Error('Invalid Docker log stream');
    return Buffer.concat(chunks).toString().split(/\r?\n/).filter(Boolean);
}
export const ownership = (project: ResolvedProject) => ({
    'chs.dev.project': project.namespace,
    'chs.dev.directory': project.directory,
    'chs.dev.backend': 'native',
});
/** Desktop grouping metadata; omit Compose execution/configuration labels. */
export function desktopLabels(
    project: Pick<ResolvedProject, 'identity' | 'namespace'>,
    service: string,
) {
    const name = project.identity.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return {
        'com.docker.compose.project': `${name}-native-${project.namespace.slice(-12)}`,
        'com.docker.compose.service': service,
    };
}
function containerPorts(spec: ServiceSpec) {
    const exposed: Record<string, {}> = {};
    const bindings: Record<string, unknown[]> = {};
    for (const port of spec.expose)
        exposed[port.includes('/') ? port : `${port}/tcp`] = {};
    for (const port of spec.ports) {
        const key = `${port.target}/${port.protocol}`;
        exposed[key] = {};
        bindings[key] ??= [];
        bindings[key].push({
            HostIp: port.hostIp ?? '',
            HostPort: port.published ?? '',
        });
    }
    return { exposed, bindings };
}

function containerMounts(
    project: ResolvedProject,
    spec: ServiceSpec,
    anonymous: Record<string, string>,
) {
    const mounts = spec.mounts.map((m) => ({
        Type: m.type,
        Source:
            m.type === 'volume'
                ? m.source
                    ? `${project.namespace}-${m.source}`
                    : anonymous[m.target]
                : m.source,
        Target: m.target,
        ReadOnly: m.readOnly,
    }));
    for (const [target, source] of Object.entries(anonymous))
        if (
            spec.imageVolumes?.includes(target) &&
            !mounts.some((m) => m.Target === target)
        )
            mounts.push({
                Type: 'volume',
                Source: source,
                Target: target,
                ReadOnly: false,
            });
    return mounts;
}

export function containerBody(
    project: ResolvedProject,
    spec: ServiceSpec,
    anonymous: Record<string, string> = {},
) {
    const { exposed, bindings } = containerPorts(spec);
    const mounts = containerMounts(project, spec, anonymous);
    const networks = Object.fromEntries(
        Object.entries(spec.networks).map(([name, opts]) => [
            `${project.namespace}-${name}`,
            { Aliases: opts.aliases },
        ]),
    );
    const [restartName, retry] = spec.restart.split(':');
    const health = spec.health && {
        Test: spec.health.test,
        Interval: spec.health.interval,
        Timeout: spec.health.timeout,
        Retries: spec.health.retries,
        StartPeriod: spec.health.startPeriod,
        StartInterval: spec.health.startInterval,
    };
    return {
        Image: spec.imageReference ?? spec.imageId ?? spec.image,
        Cmd: spec.command,
        Entrypoint: spec.entrypoint,
        Env: Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`),
        User: spec.user,
        WorkingDir: spec.workingDir,
        Hostname: spec.hostname,
        Labels: {
            ...spec.labels,
            ...desktopLabels(project, spec.name),
            ...ownership(project),
            'chs.dev.service': spec.name,
            'chs.dev.image':
                spec.image ?? `${project.namespace}/${spec.name}:dev`,
            'chs.dev.owner-service': spec.owner,
            'chs.dev.mode': spec.mode,
            'chs.dev.kind': spec.kind,
            'chs.dev.fingerprint': spec.fingerprint,
            'chs.dev.dependencies': JSON.stringify(spec.dependencies),
        },
        ExposedPorts: exposed,
        Healthcheck: health,
        StopSignal: spec.stopSignal,
        StopTimeout: spec.stopSeconds,
        HostConfig: {
            Mounts: mounts,
            PortBindings: bindings,
            NetworkMode: Object.keys(networks)[0],
            Dns: spec.dns,
            DnsSearch: spec.dnsSearch,
            ExtraHosts: spec.extraHosts,
            Memory: spec.memory,
            MemoryReservation: spec.memoryReservation,
            RestartPolicy: {
                Name: restartName,
                MaximumRetryCount: retry ? Number(retry) : 0,
            },
        },
        NetworkingConfig: { EndpointsConfig: networks },
    };
}
export async function dockerCommand(
    execute: ProcessExecutor,
    args: string[],
    directory: string,
    context: CompilationContext,
    privateOutput = false,
) {
    const result = await execute({
        command: 'docker',
        args,
        cwd: directory,
        env: context.environment,
        signal: context.signal,
        onOutput: context.onOutput,
        captureStdout: true,
        privateOutput,
    });
    if (result.code !== 0) {
        if (
            result.registryAuthenticationFailed ||
            /unauthorized|authentication required|no basic auth credentials|authorization token has expired|403 Forbidden|pull access denied/i.test(
                result.stderr,
            )
        )
            throw new LiveFailure(
                'Docker registry authentication failed. Use AWS + registry login and retry.',
                'ecr',
            );
        throw new LiveFailure(
            `Docker ${args[0]} failed (exit ${result.code}).${privateOutput ? ' Private diagnostics withheld.' : ` ${result.stderr.slice(-1000)}`}`,
        );
    }
    return result.stdout;
}
