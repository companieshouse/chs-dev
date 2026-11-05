import type {
    ContainerManager,
    ContainerSummary,
    ContainerDetails,
} from '../domain/containers.js';
import type { ContainerAction } from '../domain/live.js';
import type { OperationContext } from '../domain/runtime-strategy.js';
import { safeLog } from '../domain/live-logs.js';
import { redactInspection } from './container-inspection.js';
import { AppleRuntimeAdapter } from './native/apple-adapter.js';
import {
    appleIncarnation,
    type AppleInspection,
} from './native/apple-client.js';

type AppleConfiguration = AppleInspection['configuration'];

function appleImage(c: AppleConfiguration, l: Record<string, string>) {
    return (
        l['chs.dev.image'] ?? c.image?.reference ?? c.image?.name ?? 'unknown'
    );
}

function appleStatus(
    item: AppleInspection,
    observed: Awaited<ReturnType<AppleRuntimeAdapter['normalize']>> | undefined,
) {
    return observed?.health === 'healthy'
        ? 'Healthy'
        : item.status === 'running'
          ? 'Running'
          : item.status === 'stopped'
            ? 'Stopped'
            : item.status;
}

function applePorts(c: AppleConfiguration) {
    return (c.publishedPorts ?? []).map(
        (p: any) =>
            `${p.hostAddress ?? p.hostIP ?? '0.0.0.0'}:${p.hostPort} → ${p.containerPort}/${p.proto ?? p.protocol ?? 'tcp'}`,
    );
}

function applePlatform(c: AppleConfiguration) {
    return c.platform
        ? `${c.platform.os}/${c.platform.architecture}`
        : undefined;
}

function appleMounts(c: AppleConfiguration) {
    return (c.mounts ?? []).map((m: any) => ({
        type:
            typeof m.type === 'string'
                ? m.type
                : (Object.keys(m.type ?? {})[0] ?? 'unknown'),
        source: m.source ?? '',
        target: m.destination ?? m.target ?? '',
        readOnly: (m.options ?? []).includes('ro'),
    }));
}

function appleNetworks(item: AppleInspection) {
    return (item.networks ?? []).map((n) => ({
        name: n.network,
        addresses: [n.ipv4Address, n.ipv6Address].filter(
            (v): v is string => !!v,
        ),
    }));
}

export class AppleContainerManager implements ContainerManager {
    async streamLogs(
        container: ContainerSummary,
        options: { tail: number | 'all'; follow: boolean },
        context: OperationContext,
    ) {
        const current = await this.inspect(container.id, context.signal);
        if (current.incarnation !== container.incarnation)
            throw new Error(
                'This container changed. Refresh before reading its logs.',
            );
        await this.adapter.client.checked(
            [
                'logs',
                ...(options.follow ? ['--follow'] : []),
                ...(options.tail === 'all'
                    ? []
                    : ['--tail', String(options.tail)]),
                container.id,
            ],
            context,
            {
                captureStdout: false,
                privateOutput: true,
                streamPrivateOutput: true,
                timeout: options.follow ? 0 : 60000,
            },
        );
    }
    constructor(
        private readonly adapter: AppleRuntimeAdapter,
        private readonly changed?: (context: OperationContext) => Promise<void>,
    ) {}
    private async details(item: AppleInspection): Promise<ContainerDetails> {
        const c = item.configuration,
            l = c.labels ?? {},
            owned = this.adapter.owns(item);
        const observed = owned ? await this.adapter.normalize(item) : undefined;
        return {
            id: c.id,
            incarnation: appleIncarnation(item),
            name: c.id,
            image: appleImage(c, l),
            imageId: c.image?.descriptor?.digest,
            state: item.status === 'stopped' ? 'exited' : item.status,
            status: appleStatus(item, observed),
            health: observed?.health,
            service: l['chs.dev.service'],
            ownerService: l['chs.dev.owner-service'],
            project: l['chs.dev.project'],
            backend: l['chs.dev.backend'],
            currentProject: owned,
            ports: applePorts(c),
            platform: applePlatform(c),
            created: c.creationDate,
            started: item.startedDate,
            exitCode: observed?.exitCode,
            mounts: appleMounts(c),
            networks: appleNetworks(item),
            inspection: redactInspection(item),
        };
    }
    async list(signal?: AbortSignal) {
        return Promise.all(
            (await this.adapter.client.list(signal)).map((i) =>
                this.details(i),
            ),
        );
    }
    async inspect(id: string, signal?: AbortSignal) {
        return this.details(await this.adapter.client.inspect(id, signal));
    }
    async logs(id: string, tail: number, signal?: AbortSignal) {
        await this.adapter.client.inspect(id, signal);
        const result = await this.adapter.client.checked(
            ['logs', '-n', String(Math.max(1, Math.min(2000, tail))), id],
            { signal },
        );
        return `${result.stdout}\n${result.stderr}`
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => safeLog(line));
    }
    async action(
        action: ContainerAction,
        container: ContainerSummary,
        context: OperationContext,
    ) {
        if (!['start', 'stop', 'restart'].includes(action))
            throw new Error('Unsupported container action');
        const item = await this.adapter.client.verify(
            container.id,
            container.incarnation,
            context.signal,
        );
        if (this.adapter.owns(item) !== container.currentProject)
            throw new Error('Container ownership changed. Refresh the list.');
        if (container.currentProject)
            await this.adapter.containers.action(
                action,
                await this.adapter.normalize(item),
                context,
            );
        else {
            context.onOutput?.({
                stream: 'stdout',
                text: `${action}: ${container.name}`,
            });
            if (action !== 'start' && item.status !== 'stopped')
                await this.adapter.client.checked(
                    ['stop', '--time', '10', container.id],
                    context,
                    { timeout: 30000 },
                );
            if (action !== 'stop') {
                await this.adapter.client.verify(
                    container.id,
                    container.incarnation,
                    context.signal,
                );
                await this.adapter.client.checked(
                    ['start', container.id],
                    context,
                    { timeout: 120000 },
                );
            }
        }
        await this.changed?.(context);
        return {
            outcome: 'success' as const,
            message: `${container.name}: ${action} completed.`,
        };
    }
}
