import type { ServiceStatus } from './runtime.js';
import type { LiveRuntime } from './live.js';
import type { ContainerManager } from './containers.js';

export interface OperationResult {
    outcome: 'success' | 'failed' | 'cancelled';
    message: string;
}

export interface RuntimeProject {
    directory: string;
    name?: string;
    environment?: RuntimeEnvironment;
}

export interface RuntimeEnvironment {
    refresh?(): Promise<void>;
    resolve(
        requirements: readonly string[],
        signal?: AbortSignal,
    ): Promise<NodeJS.ProcessEnv>;
    /** Requirements that would fail resolution, reported without throwing. */
    missing?(
        requirements: readonly string[],
        signal?: AbortSignal,
    ): Promise<string[]>;
}

export interface RuntimeCapabilities {
    inspect: boolean;
    registryLogin: boolean;
    apply: boolean;
    logs: boolean;
}

export interface RuntimeAvailability {
    available: boolean;
    message: string;
}

export interface RuntimeLogEntry {
    stream: 'stdout' | 'stderr';
    text: string;
}

export interface OperationContext {
    signal?: AbortSignal;
    onOutput?: (entry: RuntimeLogEntry) => void;
}

export interface RuntimeStrategy {
    startService?(signal?: AbortSignal): Promise<OperationResult>;
    readonly id: string;
    readonly name: string;
    readonly capabilities: Readonly<RuntimeCapabilities>;
    live?(project: RuntimeProject): LiveRuntime;
    containers?(project: RuntimeProject): ContainerManager;
    checkAvailability(signal?: AbortSignal): Promise<RuntimeAvailability>;
    inspect(
        project: RuntimeProject,
        signal?: AbortSignal,
    ): Promise<Record<string, ServiceStatus>>;
    loginRegistry(
        request: { profiles: readonly string[] },
        signal?: AbortSignal,
    ): Promise<OperationResult>;
}

export function requireCapability(
    runtime: RuntimeStrategy,
    capability: keyof RuntimeCapabilities,
): void {
    if (!runtime.capabilities[capability]) {
        throw new Error(
            `${runtime.name} does not support ${capability} in this application.`,
        );
    }
}
