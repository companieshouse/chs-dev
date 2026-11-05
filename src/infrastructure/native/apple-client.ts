import { rethrowIfAborted } from '../cancellation.js';
import { arch, platform, release } from 'node:os';
import { LiveFailure } from '../../domain/live.js';
import type {
    OperationContext,
    RuntimeEnvironment,
} from '../../domain/runtime-strategy.js';
import type { ProcessExecutor, ProcessRequest } from '../live-process.js';
import { safeLog } from '../../domain/live-logs.js';

export interface AppleClientDependencies {
    directory: string;
    execute: ProcessExecutor;
    environment: RuntimeEnvironment;
    executable?: string;
}
export interface AppleInspection {
    configuration: {
        id: string;
        creationDate?: string;
        labels?: Record<string, string>;
        image?: any;
        mounts?: any[];
        publishedPorts?: any[];
        networks?: any[];
        initProcess?: any;
        platform?: { os: string; architecture: string };
        resources?: any;
    };
    status: string;
    networks?: {
        network: string;
        ipv4Address?: string;
        ipv4Gateway?: string;
        ipv6Address?: string;
    }[];
    startedDate?: string;
}
export function appleInspection(value: unknown): AppleInspection {
    const raw = value as any;
    const item: AppleInspection =
        raw?.status && typeof raw.status === 'object'
            ? {
                  ...raw,
                  status: raw.status.state,
                  networks: raw.status.networks,
                  startedDate: raw.status.startedDate,
              }
            : raw;
    if (
        !item ||
        typeof item.configuration?.id !== 'string' ||
        !['unknown', 'stopped', 'running', 'stopping'].includes(item.status)
    )
        throw new LiveFailure(
            'Unsupported Apple inspection output. This release requires container 1.5.x-compatible JSON.',
            'blocked',
        );
    return item;
}
export function appleIncarnation(item: AppleInspection): string | undefined {
    const label = item.configuration.labels?.['chs.dev.instance'];
    const created = item.configuration.creationDate;
    return label && created ? `${created}/${label}` : created;
}
function assertRegistryAuthentication(
    result: Awaited<ReturnType<AppleClient['run']>>,
) {
    const registry = /\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\b/.exec(
        result.stderr,
    )?.[0];
    if (
        result.registryAuthenticationFailed ||
        /unauthorized|no credentials found for host|authentication required|no basic auth credentials|authorization token has expired/i.test(
            result.stderr,
        ) ||
        (registry && /\b40[13]\b|forbidden|access denied/i.test(result.stderr))
    )
        throw new LiveFailure(
            `Apple registry authentication failed${registry ? ` for ${registry}` : ''}. Apple containers need their own registry login. Use AWS + registry login to continue; check Config → ECR login profiles if this registry is not covered.`,
            'ecr',
        );
}

function unavailable(error: unknown) {
    return {
        available: false,
        message: `Apple containers are unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
}

function compatibleService(status: {
    status?: string;
    paths?: { appRoot?: string };
    server?: { version?: string };
}) {
    return !(
        status.status !== 'running' ||
        !status.paths?.appRoot ||
        !/^1\.[5-9]\.|^1\.[1-9]\d+\./.test(status.server?.version ?? '')
    );
}

export class AppleClient {
    private readonly executable: string;
    private engine?: string;
    constructor(readonly dependencies: AppleClientDependencies) {
        this.executable =
            dependencies.executable ??
            process.env.CHS_DEV_APPLE_CLI ??
            'container';
    }
    async run(
        args: string[],
        context: OperationContext = {},
        options: Partial<
            Pick<
                ProcessRequest,
                | 'timeout'
                | 'stdin'
                | 'env'
                | 'privateOutput'
                | 'captureStdout'
                | 'streamPrivateOutput'
            >
        > = {},
    ) {
        const result = await this.dependencies.execute({
            command: this.executable,
            args,
            cwd: this.dependencies.directory,
            env:
                options.env ??
                (await this.dependencies.environment.resolve(
                    [],
                    context.signal,
                )),
            signal: context.signal,
            onOutput: context.onOutput,
            timeout: options.timeout ?? 30000,
            captureStdout: options.captureStdout ?? true,
            captureStderr: true,
            privateOutput: options.privateOutput ?? true,
            streamPrivateOutput: options.streamPrivateOutput,
            stdin: options.stdin,
        });
        context.signal?.throwIfAborted();
        return result;
    }
    async checked(
        args: string[],
        context: OperationContext = {},
        options: Parameters<AppleClient['run']>[2] = {},
    ) {
        const result = await this.run(args, context, options);
        if (result.code !== 0) {
            assertRegistryAuthentication(result);
            throw new LiveFailure(
                `Apple ${args[0]}${args[0] === 'create' && args.includes('--name') ? ` (${args[args.indexOf('--name') + 1]})` : ''} failed: ${safeLog(result.stderr.trim() || `exit ${result.code}`)}`,
                'failed',
            );
        }
        return result;
    }
    async json(args: string[], context: OperationContext = {}) {
        const result = await this.checked(args, context);
        try {
            return JSON.parse(result.stdout);
        } catch {
            throw new LiveFailure(
                `Apple ${args[0]} returned invalid JSON. Check the installed CLI version.`,
                'blocked',
            );
        }
    }
    async list(signal?: AbortSignal): Promise<AppleInspection[]> {
        const result = await this.json(['list', '--all', '--format', 'json'], {
            signal,
        });
        if (!Array.isArray(result))
            throw new Error('Invalid Apple container list');
        return result.map(appleInspection);
    }
    async inspect(id: string, signal?: AbortSignal) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id))
            throw new Error('Invalid Apple container identifier');
        const result = await this.json(['inspect', id], { signal });
        if (!Array.isArray(result) || result.length !== 1)
            throw new Error('Container no longer exists. Refresh the list.');
        const item = appleInspection(result[0]);
        if (item.configuration.id !== id)
            throw new Error('Container identity changed');
        return item;
    }
    async verify(
        id: string,
        incarnation: string | undefined,
        signal?: AbortSignal,
    ) {
        const current = await this.inspect(id, signal);
        if (!incarnation || incarnation !== appleIncarnation(current))
            throw new LiveFailure(
                'Container changed since it was selected. Refresh before trying again.',
                'blocked',
            );
        return current;
    }
    async installation(signal?: AbortSignal) {
        if (
            platform() !== 'darwin' ||
            arch() !== 'arm64' ||
            Number(release().split('.')[0]) < 25
        )
            return {
                available: false,
                message:
                    'Apple containers require Apple silicon and macOS 26 or later.',
            };
        try {
            const version = await this.checked(['--version'], { signal });
            const match = /version\s+(\d+)\.(\d+)\.(\d+)/.exec(version.stdout);
            if (!match || Number(match[1]) !== 1 || Number(match[2]) < 5)
                return {
                    available: false,
                    message:
                        'Apple container 1.5.0 or a compatible newer 1.x release is required. Upgrade the Apple CLI.',
                };
            return { available: true, message: 'Apple CLI is compatible.' };
        } catch (error) {
            rethrowIfAborted(signal, error);
            return unavailable(error);
        }
    }
    async availability(signal?: AbortSignal) {
        const installation = await this.installation(signal);
        if (!installation.available) return installation;
        try {
            return await this.serviceAvailability(signal);
        } catch (error) {
            rethrowIfAborted(signal, error);
            return unavailable(error);
        }
    }
    private async serviceAvailability(signal?: AbortSignal) {
        const state = await this.run(['system', 'status', '--format', 'json'], {
            signal,
        });
        if (
            state.code !== 0 ||
            /not running|not registered/i.test(state.stdout + state.stderr)
        )
            return {
                available: false,
                message:
                    'Apple container service is stopped. Start it with container system start, then retry.',
            };
        const status = JSON.parse(state.stdout);
        if (!compatibleService(status))
            return {
                available: false,
                message:
                    'Apple service and CLI must both support version 1.5.0. Restart the service after upgrading.',
            };
        if (this.engine && this.engine !== status.paths.appRoot)
            return {
                available: false,
                message:
                    'The Apple engine data directory changed. Restart chs-dev before managing containers.',
            };
        this.engine = status.paths.appRoot;
        return {
            available: true,
            message:
                'Apple containers are available. Health monitoring runs while the chs-dev daemon is running.',
        };
    }
}
