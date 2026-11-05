import type {
    LiveState,
    ContainerAction,
    LivePreview,
} from '../domain/live.js';
import type { LegacyEdit, ProjectSelections } from '../domain/configuration.js';
import type {
    ServiceGroup,
    ServiceDetails,
    ServiceEdit,
} from '../domain/services.js';
import type {
    SettingsSnapshot,
    SettingKey,
    SettingValues,
} from '../domain/settings.js';
import type { ProjectConfig } from '../domain/project.js';
import type {
    EnvironmentProfile,
    ProfilePreview,
} from '../domain/environment-profile.js';
import type {
    CidevVersionOptions,
    CidevVersionResult,
    VersionSnapshot,
} from '../domain/aws-versions.js';
import type { AwsEnvironment } from '../domain/version-sources.js';
import type { AwsStatus } from '../domain/aws.js';
import type { ProfileDiscovery } from '../domain/aws-profiles.js';
import type {
    ContainerSummary,
    ContainerDetails,
} from '../domain/containers.js';
import type { ServiceStatus } from '../domain/runtime.js';
import type {
    OperationResult,
    RuntimeCapabilities,
} from '../domain/runtime-strategy.js';

export const protocolVersion = 2;
export interface Scope {
    project: string;
    generation: string;
}
export interface DiagnosticSnapshot {
    lines: readonly string[];
    sequence: number;
    failure: string;
    path: string;
}
export interface ProjectSearch {
    found: { directory: string; valid: boolean; message: string }[];
    visited: number;
    searching: boolean;
    truncated: boolean;
}
export interface SessionSnapshot {
    protocol: number;
    daemonId: string;
    scope: Scope;
    changedAt: string;
    ready: boolean;
    project: ProjectConfig;
    groups: ServiceGroup[];
    details: Record<string, ServiceDetails>;
    configurationRevision: string;
    configurationError: string;
    settings: SettingsSnapshot;
    settingsRevision: string;
    runtime: {
        id: string;
        name: string;
        capabilities: RuntimeCapabilities;
        canStart: boolean;
    };
    statuses: Record<string, ServiceStatus>;
    runtimeState: 'loading' | 'ready' | 'error';
    aws: AwsStatus;
    live: LiveState;
    operations: Operation[];
    interaction?: { id: string; label: string; claimed: boolean };
    search: ProjectSearch;
    home: string;
    notice?: string;
}
export interface ApiError {
    code: string;
    message: string;
    operationId?: string;
    data?: unknown;
}
export class ClientError extends Error {
    constructor(readonly detail: ApiError) {
        super(detail.message);
        this.name = 'ClientError';
    }
}
export type OperationState =
    'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface Operation {
    id: string;
    requestId: string;
    kind: CommandName;
    clientId: string;
    scope: Scope;
    state: OperationState;
    createdAt: string;
    updatedAt: string;
    result?: unknown;
    error?: ApiError;
}
type Command<A, R = void> = { args: A; result: R };
type Empty = Record<string, never>;
export interface CommandMap {
    'environment.profileImport': Command<
        {
            profile: EnvironmentProfile;
            versionsOnly: boolean;
            revision: string;
        },
        { revision: string; selections: ProjectSelections }
    >;
    'environment.profileExport': Command<
        { path: string; force?: boolean; profile?: EnvironmentProfile },
        { path: string; warnings: string[] }
    >;
    'environment.start': Command<{ approveStops?: boolean }>;
    'environment.apply': Command<{ approveStops?: boolean }>;
    'environment.stop': Command<Empty>;
    'environment.cancel': Command<Empty>;
    'environment.confirm': Command<{ plan: string }>;
    'environment.dismiss': Command<Empty>;
    'service.action': Command<
        { services: string[]; action: ContainerAction },
        { ok: boolean; message: string }
    >;
    'service.reload': Command<
        { service: string },
        { ok: boolean; message: string }
    >;
    'container.action': Command<
        { container: ContainerSummary; action: ContainerAction },
        { ok: boolean; message: string }
    >;
    'configuration.save': Command<{ edit: ServiceEdit; revision: string }>;
    'configuration.legacyEdit': Command<
        { edit: LegacyEdit; revision: string },
        { revision: string; selections: ProjectSelections }
    >;
    'settings.save': Command<{
        key: SettingKey;
        value?: SettingValues[SettingKey];
        revision: string;
    }>;
    'ssh.setup': Command<
        { keyPath: string; passphrase: string; replace: boolean },
        boolean
    >;
    'authentication.login': Command<
        { action: 'aws' | 'registry'; automatic?: boolean },
        OperationResult
    >;
    'project.clone': Command<{ destination: string }, OperationResult>;
    'runtime.start': Command<Empty, OperationResult>;
}
export type CommandName = keyof CommandMap;
export type CommandRequest<K extends CommandName = CommandName> = {
    [Name in K]: {
        protocol: number;
        clientId: string;
        requestId: string;
        scope: Scope;
        command: Name;
        args: CommandMap[Name]['args'];
    };
}[K];
export interface QueryMap {
    'environment.versionSnapshot': Command<
        { source: AwsEnvironment; refresh?: boolean },
        VersionSnapshot
    >;
    'environment.profile': Command<Empty, EnvironmentProfile>;
    'environment.profileRead': Command<{ path: string }, EnvironmentProfile>;
    'environment.profilePreview': Command<
        { profile: EnvironmentProfile; versionsOnly: boolean },
        ProfilePreview
    >;
    'environment.cidevVersions': Command<
        CidevVersionOptions,
        CidevVersionResult
    >;
    'environment.preview': Command<
        Empty,
        { plan: LivePreview; revision: string }
    >;
    'configuration.snapshot': Command<
        Empty,
        { revision: string; selections: ProjectSelections }
    >;
    'dependency.diagram': Command<{ services: string[] }, { paths: string[] }>;
    'containers.list': Command<Empty, ContainerSummary[]>;
    'containers.inspect': Command<{ id: string }, ContainerDetails>;
    'containers.logs': Command<{ id: string; tail: number }, string[]>;
    'services.logs': Command<{ service: string; tail: number }, string[]>;
    'aws.discovery': Command<Empty, ProfileDiscovery>;
    'aws.refresh': Command<Empty, AwsStatus>;
    'project.search': Command<Empty, ProjectSearch>;
    'project.validate': Command<
        { directory: string },
        ProjectConfig & { origin?: string; expectedOrigin: boolean }
    >;
    'project.cloneDestination': Command<
        { directory: string },
        { error?: string }
    >;
    'project.defaultDestination': Command<Empty, string>;
    diagnostics: Command<Empty, DiagnosticSnapshot>;
    refresh: Command<Empty>;
}
export type QueryName = keyof QueryMap;
export type QueryRequest<K extends QueryName = QueryName> = {
    [Name in K]: { scope: Scope; query: Name; args: QueryMap[Name]['args'] };
}[K];
export interface StateEvent {
    snapshot: SessionSnapshot;
    logFrom: number;
    logLines: readonly string[];
}
export interface LogRequest {
    scope: Scope;
    source: 'environment' | 'services';
    services: string[];
    tail: number | 'all';
    follow: boolean;
}

export const emptyLive: LiveState = {
    running: false,
    autoApply: true,
    phase: 'Stopped',
    message: '',
    stoppedByUser: [],
    logs: [],
    logSequence: 0,
    busy: false,
};
export function operationFinished(operation: Operation) {
    return !['queued', 'running'].includes(operation.state);
}
