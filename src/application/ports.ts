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
import type { StackMeasurement } from '../domain/measurements.js';
import type { ProxyState } from '../domain/environment.js';
import type { AwsStatus } from '../domain/aws.js';
import type { ProfileDiscovery } from '../domain/aws-profiles.js';
import type {
    DiagnosticSnapshot,
    ProjectSearch,
    Scope,
} from '../protocol/types.js';
import type { InteractiveCommand } from './interactions.js';
import type { UsageSnapshot } from './usage-tracker.js';
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

export interface EnvironmentProfileStore {
    snapshot(): Promise<EnvironmentProfile>;
    preview(
        profile: EnvironmentProfile,
        versionsOnly?: boolean,
    ): Promise<ProfilePreview>;
    read(path: string): Promise<EnvironmentProfile>;
    export(
        path: string,
        force?: boolean,
        profile?: EnvironmentProfile,
    ): Promise<{ path: string; warnings: string[] }>;
    save(options: {
        profile: EnvironmentProfile;
        versionsOnly: boolean;
        revision: string;
    }): Promise<{ revision: string; selections: ProjectSelections }>;
}

export interface BackendSession {
    project: ProjectConfig;
    groups: ServiceGroup[];
    runtime: RuntimeStrategy;
    controller?: LiveController;
    manager?: ContainerManager;
    profiles?: EnvironmentProfileStore;
    versionSnapshot?(
        source: AwsEnvironment,
        signal?: AbortSignal,
        refresh?: boolean,
    ): Promise<VersionSnapshot>;
    cidevVersions?(
        options: CidevVersionOptions,
        signal?: AbortSignal,
    ): Promise<CidevVersionResult>;
    readConfiguration(): Promise<{
        details: Record<string, ServiceDetails>;
        revision: string;
        error: string;
    }>;
    save(edit: ServiceEdit, revision: string): Promise<void>;
    saveJourney?(input: {
        name: string;
        services: string[];
        lazy: string[];
        excluded?: string[];
    }): Promise<{ path: string }>;
    configurationSnapshot?(): Promise<{
        revision: string;
        selections: ProjectSelections;
    }>;
    saveLegacy?(
        edit: LegacyEdit,
        revision: string,
    ): Promise<{ revision: string; selections: ProjectSelections }>;
    dependencyDiagram?(
        services: string[],
        signal?: AbortSignal,
    ): Promise<{ paths: string[] }>;
    measure?(journey?: string): Promise<StackMeasurement>;
    journeys?(): Promise<{
        journeys: Array<{
            name: string;
            services: string[];
            lazy: string[];
            excluded: string[];
        }>;
        invalid: Array<{ file: string; error: string }>;
        active?: string;
    }>;
    deleteJourney?(name: string): Promise<{
        deleted: boolean;
        selectionCleared: boolean;
    }>;
    accounting?(): Promise<ProxyState>;
    /** The checkout's usage cache state, for display. */
    usage?(): Promise<UsageSnapshot>;
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
