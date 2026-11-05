import type { ContainerAction } from './live.js';
import type { OperationContext, OperationResult } from './runtime-strategy.js';

export interface ContainerSummary {
    id: string;
    incarnation?: string;
    name: string;
    image: string;
    imageId?: string;
    state: string;
    status: string;
    health?: string;
    service?: string;
    ownerService?: string;
    project?: string;
    backend?: string;
    currentProject: boolean;
    ports: string[];
}

export interface ContainerDetails extends ContainerSummary {
    platform?: string;
    created?: string;
    started?: string;
    finished?: string;
    exitCode?: number;
    mounts: {
        type: string;
        source: string;
        target: string;
        readOnly: boolean;
    }[];
    networks: { name: string; addresses: string[] }[];
    /** Engine-specific inspection data, with credentials and environment values hidden. */
    inspection: unknown;
}

/** Container management is independent of project orchestration and engine commands. */
export interface ContainerManager {
    list(signal?: AbortSignal): Promise<ContainerSummary[]>;
    inspect(id: string, signal?: AbortSignal): Promise<ContainerDetails>;
    logs(id: string, tail: number, signal?: AbortSignal): Promise<string[]>;
    streamLogs?(
        container: ContainerSummary,
        options: { tail: number | 'all'; follow: boolean },
        context: OperationContext,
    ): Promise<void>;
    action(
        action: ContainerAction,
        container: ContainerSummary,
        context: OperationContext,
    ): Promise<OperationResult>;
}

export function imageVersion(reference: string): string {
    if (reference.includes('@')) return reference.split('@')[1];
    if (/^sha256:/.test(reference)) return reference;
    const last = reference.split('/').at(-1)!;
    return last.includes(':')
        ? last.slice(last.lastIndexOf(':') + 1)
        : 'latest (implicit)';
}

export function serviceContainers(
    containers: readonly ContainerSummary[],
    service: string,
) {
    return containers.filter(
        (c) =>
            c.currentProject &&
            (c.service === service || c.ownerService === service),
    );
}

export function filterContainers(
    containers: readonly ContainerSummary[],
    options: { all: boolean; query: string; service?: string },
): ContainerSummary[] {
    const query = options.query.toLowerCase();
    return containers
        .filter(
            (c) =>
                (options.all || c.currentProject) &&
                (!options.service ||
                    (c.currentProject &&
                        (c.service === options.service ||
                            c.ownerService === options.service))) &&
                [
                    c.name,
                    c.id,
                    c.image,
                    c.status,
                    c.service,
                    c.ownerService,
                    c.project,
                ].some((value) => value?.toLowerCase().includes(query)),
        )
        .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
}

export const isRunningContainer = (state: string) =>
    ['running', 'restarting'].includes(state);
export const isActiveContainer = (state: string) =>
    isRunningContainer(state) || state === 'paused';
export const permitsContainerAction = (state: string) =>
    !['paused', 'removing', 'dead'].includes(state);
