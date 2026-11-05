import type { LiveController, LiveIntent } from './live-controller.js';
import type { LegacyEdit, ProjectSelections } from '../domain/configuration.js';
import type { ContainerManager } from '../domain/containers.js';
import type {
    RuntimeStrategy,
    OperationResult,
} from '../domain/runtime-strategy.js';
import type {
    SettingsSnapshot,
    SettingKey,
    SettingValues,
    ResolvedSettings,
} from '../domain/settings.js';
import type {
    ServiceGroup,
    ServiceDetails,
    ServiceEdit,
} from '../domain/services.js';
import type { ProjectConfig } from '../domain/project.js';
import type { AwsStatus } from '../domain/aws.js';
import type { ProfileDiscovery } from '../domain/aws-profiles.js';
import type {
    DiagnosticSnapshot,
    ProjectSearch,
    Scope,
} from '../protocol/types.js';
import type { InteractiveCommand } from './interactions.js';

export interface BackendSession {
    project: ProjectConfig;
    groups: ServiceGroup[];
    runtime: RuntimeStrategy;
    controller?: LiveController;
    manager?: ContainerManager;
    readConfiguration(): Promise<{
        details: Record<string, ServiceDetails>;
        revision: string;
        error: string;
    }>;
    save(edit: ServiceEdit, revision: string): Promise<void>;
    configurationSnapshot?(): Promise<{
        revision: string;
        selections: ProjectSelections;
    }>;
    saveLegacy?(
        edit: LegacyEdit,
        revision: string,
        beforeCommit?: (revision: string) => Promise<void>,
    ): Promise<{ revision: string; selections: ProjectSelections }>;
    dependencyDiagram?(
        services: string[],
        signal?: AbortSignal,
    ): Promise<{ paths: string[] }>;
    close(): Promise<void>;
}
export interface SessionIntent {
    version: 1;
    hostSession: string;
    scope: Scope;
    backend: string;
    intent?: LiveIntent;
    interrupted: boolean;
    switching?: boolean;
}
export interface ApplicationHost {
    id(): string;
    home: string;
    hostSession: string;
    settings(): SettingsSnapshot;
    settingsRevision(): string;
    previewSetting(
        key: SettingKey,
        value: SettingValues[SettingKey] | undefined,
    ): ResolvedSettings;
    saveSetting(
        key: SettingKey,
        value: SettingValues[SettingKey] | undefined,
    ): Promise<void>;
    activateSettings(): void;
    refreshSettings?(): Promise<void>;
    open(intent?: LiveIntent): Promise<BackendSession>;
    validateProject(
        directory: string,
    ): Promise<ProjectConfig & { origin?: string; expectedOrigin: boolean }>;
    readIntent(): Promise<SessionIntent | undefined>;
    writeIntent(intent: SessionIntent): Promise<void>;
    aws(signal?: AbortSignal): Promise<AwsStatus>;
    discovery(directory?: string): Promise<ProfileDiscovery>;
    login(
        backend: BackendSession,
        action: 'aws' | 'registry',
        signal: AbortSignal,
        run: (r: InteractiveCommand) => Promise<OperationResult>,
    ): Promise<OperationResult>;
    clone(
        destination: string,
        signal: AbortSignal,
        run: (r: InteractiveCommand) => Promise<OperationResult>,
    ): Promise<OperationResult>;
    search(
        update: (state: ProjectSearch) => void,
        signal: AbortSignal,
    ): Promise<void>;
    cloneDestination(directory: string): Promise<string | undefined>;
    defaultDestination(): Promise<string>;
    diagnostics(): DiagnosticSnapshot;
}
