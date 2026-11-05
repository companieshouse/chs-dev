import type {
    ContainerAction,
    RuntimeContainer,
    RuntimeSnapshot,
} from './live.js';
import type {
    OperationContext,
    RuntimeAvailability,
} from './runtime-strategy.js';
import type {
    Dependency,
    ResolvedProject,
    ServiceSpec,
} from './orchestration.js';

export interface ObservedContainer extends RuntimeContainer {
    addresses?: Record<string, string>;
    ipv6Addresses?: Record<string, string>;
    dependencies: Record<string, Dependency>;
    anonymousVolumes: Record<string, string>;
    stopSeconds: number;
}
export interface ContainerOperations {
    storageIdentity?(id: string, signal?: AbortSignal): Promise<unknown>;
    exec?(
        id: string,
        args: string[],
        context: OperationContext,
        stdin?: string | Buffer,
    ): Promise<{ code: number; stdout: string; stderr: string }>;
    copyTo?(
        id: string,
        source: string,
        target: string,
        context: OperationContext,
    ): Promise<void>;
    list(signal?: AbortSignal): Promise<ObservedContainer[]>;
    inspectOwned(id: string, signal?: AbortSignal): Promise<ObservedContainer>;
    create(
        project: ResolvedProject,
        service: ServiceSpec,
        volumes: Record<string, string>,
        context: OperationContext,
    ): Promise<ObservedContainer>;
    action(
        action: ContainerAction,
        container: ObservedContainer,
        context: OperationContext,
    ): Promise<void>;
    remove(
        container: ObservedContainer,
        context: OperationContext,
    ): Promise<void>;
    logs(id: string, tail: number, signal?: AbortSignal): Promise<string[]>;
}
export interface ImageOperations {
    prepare(
        project: ResolvedProject,
        reload: readonly string[],
        context: OperationContext,
    ): Promise<void>;
}
export interface ResourceOperations {
    ensure(
        project: ResolvedProject,
        create: boolean,
        fingerprint: (value: unknown) => string,
        context: OperationContext,
    ): Promise<void>;
}
export interface RuntimeAdapter {
    readonly name: string;
    readonly containers: ContainerOperations;
    readonly images: ImageOperations;
    readonly resources: ResourceOperations;
    readonly stateKey?: string;
    probe?(context: OperationContext): Promise<void>;
    monitor?(context: OperationContext): Promise<void>;
    close?(): Promise<void>;
    checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability>;
    environment(
        requirements: readonly string[],
        signal?: AbortSignal,
    ): Promise<NodeJS.ProcessEnv>;
    preflight(project?: ResolvedProject, signal?: AbortSignal): Promise<void>;
}
