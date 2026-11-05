import { realpath } from 'node:fs/promises';
import type {
    ContainerDetails,
    ContainerManager,
    ContainerSummary,
} from '../domain/containers.js';
import type { ContainerAction } from '../domain/live.js';
import type { OperationContext } from '../domain/runtime-strategy.js';
import { safeLog } from '../domain/live-logs.js';
import { containerStatus } from './runtimes/docker-state.js';
import type { ProcessExecutor } from './live-process.js';

interface Dependencies {
    directory: string;
    execute: ProcessExecutor;
    environment(signal?: AbortSignal): Promise<NodeJS.ProcessEnv>;
}

export { redactInspection } from './container-inspection.js';
import { redactInspection } from './container-inspection.js';

function inspectionPorts(
    ports: Record<string, { HostPort?: string; HostIp?: string }[] | null>,
) {
    return Object.entries(ports).flatMap(([key, bindings]) => {
        const [port, type] = key.split('/');
        return (bindings?.length ? bindings : [{}]).map((binding) => ({
            PrivatePort: port,
            Type: type,
            PublicPort: binding.HostPort,
            IP: binding.HostIp,
        }));
    });
}

function stoppedService(
    state: string,
    exitCode: number,
    labels: Record<string, string> | undefined,
) {
    return (
        state === 'exited' &&
        exitCode === 0 &&
        labels?.['chs.dev.kind'] !== 'job'
    );
}

export class DockerContainerManager implements ContainerManager {
    constructor(private readonly dependencies: Dependencies) {}

    private async run(args: string[], signal?: AbortSignal, timeout = 15000) {
        const result = await this.dependencies.execute({
            command: 'docker',
            args,
            cwd: this.dependencies.directory,
            env: await this.dependencies.environment(signal),
            signal,
            timeout,
            captureStdout: true,
            captureStderr: true,
            privateOutput: true,
        });
        signal?.throwIfAborted();
        if (result.code !== 0)
            throw new Error(
                safeLog(
                    result.stderr.trim() ||
                        `Docker ${args[0]} failed. Check the selected engine is available.`,
                ),
            );
        return result;
    }

    private validateId(id: string) {
        if (!/^[a-f0-9]{64}$/.test(id))
            throw new Error(
                'A full container ID is required. Refresh the container list.',
            );
    }
    private async belongsToCheckout(labels: Record<string, string>) {
        const directory =
            labels['chs.dev.directory'] ??
            labels['com.docker.compose.project.working_dir'];
        if (!directory) return false;
        const [actual, expected] = await Promise.all([
            realpath(directory).catch(() => directory),
            realpath(this.dependencies.directory).catch(
                () => this.dependencies.directory,
            ),
        ]);
        return actual === expected;
    }
    private async summary(item: any): Promise<ContainerSummary> {
        const labels = item.Labels ?? {};
        return {
            id: item.Id,
            name: (item.Names?.[0] ?? item.Id.slice(0, 12)).replace(/^\//, ''),
            image: item.Image,
            imageId: item.ImageID,
            state: item.State,
            status: item.Status,
            service:
                labels['chs.dev.service'] ??
                labels['com.docker.compose.service'],
            ownerService: labels['chs.dev.owner-service'],
            project:
                labels['com.docker.compose.project'] ??
                labels['chs.dev.project'],
            backend:
                labels['chs.dev.backend'] ??
                (labels['com.docker.compose.project'] ? 'compose' : undefined),
            currentProject: await this.belongsToCheckout(labels),
            ports: (item.Ports ?? []).map(
                (p: any) =>
                    `${p.PublicPort ? `${p.IP || '0.0.0.0'}:${p.PublicPort} → ` : ''}${p.PrivatePort}/${p.Type}`,
            ),
        };
    }
    async list(signal?: AbortSignal): Promise<ContainerSummary[]> {
        // List full IDs, then inspect in batches to preserve structured labels and ports.
        const result = await this.run(
            [
                'container',
                'ls',
                '--all',
                '--no-trunc',
                '--format',
                '{{json .}}',
            ],
            signal,
        );
        const rows = result.stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        // CLI list labels are a comma-joined string; inspect IDs to avoid misparsing label values.
        const summaries: ContainerSummary[] = [];
        for (let index = 0; index < rows.length; index += 50) {
            signal?.throwIfAborted();
            const ids = rows
                .slice(index, index + 50)
                .map((row) => row.ID as string);
            ids.forEach((id) => this.validateId(id));
            const response = await this.dependencies.execute({
                command: 'docker',
                args: ['container', 'inspect', ...ids],
                cwd: this.dependencies.directory,
                env: await this.dependencies.environment(signal),
                signal,
                timeout: 15000,
                captureStdout: true,
                captureStderr: true,
                privateOutput: true,
            });
            signal?.throwIfAborted();
            if (
                response.code !== 0 &&
                !/No such (?:object|container)/i.test(response.stderr)
            )
                throw new Error(
                    safeLog(
                        response.stderr || 'Cannot inspect Docker containers.',
                    ),
                );
            for (const detail of JSON.parse(response.stdout || '[]'))
                summaries.push(await this.fromInspection(detail));
        }
        return summaries.sort((a, b) => a.name.localeCompare(b.name));
    }
    private async fromInspection(detail: any): Promise<ContainerSummary> {
        const config = detail.Config ?? {};
        const state = detail.State ?? { Status: 'unknown' };
        const summary = await this.summary({
            Id: detail.Id,
            Names: [detail.Name],
            Image: config.Image ?? detail.Image,
            ImageID: detail.Image,
            Labels: config.Labels,
            State: state.Status,
            Status: containerStatus(state),
            Ports: inspectionPorts(detail.NetworkSettings?.Ports ?? {}),
        });
        if (stoppedService(summary.state, state.ExitCode, config.Labels))
            summary.status = 'Stopped';
        return { ...summary, health: state.Health?.Status };
    }

    async inspect(id: string, signal?: AbortSignal): Promise<ContainerDetails> {
        this.validateId(id);
        const result = await this.run(['container', 'inspect', id], signal);
        const detail = JSON.parse(result.stdout)[0];
        if (!detail || detail.Id !== id)
            throw new Error(
                'The selected container no longer exists. Refresh the list.',
            );
        return {
            ...(await this.fromInspection(detail)),
            created: detail.Created,
            started: detail.State?.StartedAt,
            finished: detail.State?.FinishedAt,
            exitCode: detail.State?.ExitCode,
            mounts: (detail.Mounts ?? []).map((m: any) => ({
                type: m.Type,
                source: m.Source ?? m.Name ?? '',
                target: m.Destination,
                readOnly: !m.RW,
            })),
            networks: Object.entries(
                detail.NetworkSettings?.Networks ?? {},
            ).map(([name, n]: [string, any]) => ({
                name,
                addresses: [n.IPAddress, n.GlobalIPv6Address].filter(Boolean),
            })),
            inspection: redactInspection(detail),
        };
    }
    async logs(id: string, tail: number, signal?: AbortSignal) {
        this.validateId(id);
        const result = await this.run(
            [
                'container',
                'logs',
                '--timestamps',
                '--tail',
                String(Math.max(1, Math.min(2000, tail))),
                id,
            ],
            signal,
        );
        return `${result.stdout}\n${result.stderr}`
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => safeLog(line))
            .sort((a, b) => a.split(' ')[0].localeCompare(b.split(' ')[0]));
    }
    async action(
        action: ContainerAction,
        container: ContainerSummary,
        context: OperationContext,
    ) {
        if (!['start', 'stop', 'restart'].includes(action))
            throw new Error('Unsupported container action.');
        const current = await this.inspect(container.id, context.signal);
        if (
            current.currentProject !== container.currentProject ||
            current.service !== container.service
        )
            throw new Error(
                'Container ownership changed. Refresh the list before trying again.',
            );
        if (current.state === 'paused')
            throw new Error(
                'This container is paused. Unpause it before using start, stop or restart.',
            );
        context.onOutput?.({
            stream: 'stdout',
            text: `${action}: ${current.name}`,
        });
        await this.run(
            ['container', action, current.id],
            context.signal,
            600000,
        );
        return {
            outcome: 'success' as const,
            message: `${current.name}: ${action} completed.`,
        };
    }
    async streamLogs(
        container: ContainerSummary,
        options: { tail: number | 'all'; follow: boolean },
        context: OperationContext,
    ) {
        this.validateId(container.id);
        const result = await this.dependencies.execute({
            command: 'docker',
            args: [
                'container',
                'logs',
                '--timestamps',
                '--tail',
                String(options.tail),
                ...(options.follow ? ['--follow'] : []),
                container.id,
            ],
            cwd: this.dependencies.directory,
            env: await this.dependencies.environment(context.signal),
            ...context,
            timeout: options.follow ? 0 : 60000,
            captureStdout: false,
            captureStderr: true,
            privateOutput: true,
            streamPrivateOutput: true,
        });
        context.signal?.throwIfAborted();
        if (result.code !== 0)
            throw new Error(
                safeLog(result.stderr || 'Cannot stream Docker logs.'),
            );
    }
}
