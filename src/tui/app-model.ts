import type { Client, ClientSnapshot } from '../client/client.js';
import { containerClient } from '../client/environment.js';
import { useClient, useSession } from './context.js';
import type { ProfileDiscovery } from '../domain/aws-profiles.js';
import { autoLoginStep, initialAutoLoginMemory } from '../domain/auto-login.js';
import type { LoginAction, LoginResult } from '../domain/aws.js';
import { useAwsStatus } from './hooks/use-aws-status.js';
import { useOverlayState } from './hooks/use-overlay-stack.js';
import { useLoginFlow, type TerminalControl } from './hooks/use-login-flow.js';
import { useEditors } from './hooks/use-editors.js';
import { environmentSummary } from '../domain/environment.js';
import {
    globalKeyAction,
    supportsSearch,
    type GlobalKeyAction,
    type GlobalKeyContext,
} from './models/keymap.js';
import { useApp, useInput, useWindowSize, type Key } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from './hooks/use-settings.js';
import { useAwsDiscovery } from './hooks/use-aws-discovery.js';
import { useProject } from './hooks/use-project.js';
import { useRuntimeStatus } from './hooks/use-runtime-status.js';
import { nextTab, tabDirection, type Tab } from './models/navigation.js';
import type { ContainerRequest } from './components/containers-screen.js';
import { useLive } from './hooks/use-live.js';
import type { LogFilter } from '../domain/log-view.js';
import type { LiveState } from '../domain/live.js';

export function statusNotice(
    loginBusy: boolean,
    session: ClientSnapshot,
    loginNotice: { text: string; tone: 'success' | 'muted' } | undefined,
) {
    if (loginBusy) return { text: 'Logging in…', tone: 'muted' as const };
    if (session.connection !== 'connected')
        return {
            text: 'Disconnected — reconnecting to daemon…',
            tone: 'muted' as const,
        };
    if (session.notice) return { text: session.notice, tone: 'muted' as const };
    return loginNotice;
}

function ecrPlanFor(
    configured: string[] | undefined,
    discovery: ProfileDiscovery | undefined,
    primary: string,
) {
    if (configured?.length)
        return { profiles: configured, source: 'configured', unmatched: [] };
    if (!discovery) return undefined;
    return {
        profiles: discovery.recommended.length
            ? discovery.recommended
            : [primary],
        source: discovery.recommended.length ? 'detected' : 'primary profile',
        unmatched: discovery.unmatched,
    };
}

function environmentFor(
    project: ReturnType<typeof useProject>,
    runtimeStatus: ReturnType<typeof useRuntimeStatus>,
    state: LiveState,
) {
    const { projectConfig, details, error, loading, stateLoading } = project;
    if (!projectConfig?.valid || error) return undefined;
    return environmentSummary(
        details,
        runtimeStatus.statuses,
        loading || stateLoading ? 'loading' : runtimeStatus.runtimeState,
        state.phase === 'Preparing' || state.phase === 'Applying',
    );
}

function useGenerationCache<T>(generation: string, value: T): T {
    const cache = useRef<{ generation: string; value: T }>(undefined);
    if (!cache.current || cache.current.generation !== generation)
        cache.current = { generation, value };
    return cache.current.value;
}

function useRuntime(client: Client, session: ClientSnapshot) {
    const base = useGenerationCache(session.scope.generation, session.runtime);
    return useMemo(
        () => ({
            ...base,
            startService: base.canStart
                ? () => client.command('runtime.start', {})
                : undefined,
        }),
        [client, base],
    );
}

function useContainerManager(
    client: Client,
    scope: ClientSnapshot['scope'],
    valid: boolean | undefined,
) {
    const cachedScope = useGenerationCache(scope.generation, scope);
    return useMemo(
        () => (valid ? containerClient(client, cachedScope) : undefined),
        [client, valid, cachedScope],
    );
}

function useWorkspaceUi() {
    const [activeTab, setActiveTab] = useState<Tab>('Services');
    const [containerRequest, setContainerRequest] =
        useState<ContainerRequest>();
    const [logsView, setLogsView] = useState<{
        id: number;
        filter: LogFilter;
        source: 'tui' | 'live';
    }>({ id: 0, filter: 'All', source: 'tui' });
    const [loginBusy, setLoginBusy] = useState(false);
    const [loginResult, setLoginResult] = useState<LoginResult>();
    const overlays = useOverlayState();
    const openServiceContainers = (service: string) => {
        overlays.setModalService(undefined);
        setActiveTab('Containers');
        setContainerRequest((previous) => ({
            service,
            sequence: (previous?.sequence ?? 0) + 1,
        }));
    };
    return {
        activeTab,
        setActiveTab,
        containerRequest,
        setContainerRequest,
        logsView,
        setLogsView,
        loginBusy,
        setLoginBusy,
        loginResult,
        setLoginResult,
        ...overlays,
        openServiceContainers,
    };
}

export type WorkspaceUi = ReturnType<typeof useWorkspaceUi>;

type AutoLoginInput = Parameters<typeof autoLoginStep>[0];

function useAutoLogin(
    quickLogin: (action: LoginAction, reason?: string) => Promise<void>,
    mode: AutoLoginInput['mode'],
    awsState: AutoLoginInput['aws'],
    state: LiveState,
    flags: {
        loginOverlayOpen: boolean;
        loginBusy: boolean;
        environmentOpen: boolean;
        preference: AutoLoginInput['preference'];
        interaction: ClientSnapshot['interaction'];
        connection: ClientSnapshot['connection'];
    },
) {
    const memory = useRef(initialAutoLoginMemory);
    const {
        loginOverlayOpen,
        loginBusy,
        environmentOpen,
        preference,
        interaction,
        connection,
    } = flags;
    const interacting = Boolean(interaction);
    useEffect(() => {
        const decision = autoLoginStep(
            {
                mode,
                aws: awsState,
                phase: state.phase,
                blocked: state.blocked,
                idle:
                    !loginOverlayOpen &&
                    !loginBusy &&
                    !state.busy &&
                    !interacting &&
                    connection === 'connected',
                environmentOpen,
                preference,
            },
            memory.current,
        );
        memory.current = decision.memory;
        if (decision.login)
            void quickLogin(decision.login.kind, decision.login.reason);
    }, [
        quickLogin,
        mode,
        awsState,
        state.phase,
        state.blocked,
        state.busy,
        loginOverlayOpen,
        loginBusy,
        environmentOpen,
        preference,
        interacting,
        connection,
    ]);
}

function useFailureAlerts(
    state: LiveState,
    deferred: boolean,
    onAlert: () => void,
) {
    const notifiedFailure = useRef<string | undefined>(undefined);
    const notifiedSshSetup = useRef<string | undefined>(undefined);
    const failureMessage =
        state.phase === 'Failed'
            ? state.message || 'The environment operation failed.'
            : undefined;
    useEffect(() => {
        if (!failureMessage) {
            notifiedFailure.current = undefined;
            return;
        }
        if (deferred || notifiedFailure.current === failureMessage) return;
        notifiedFailure.current = failureMessage;
        onAlert();
    }, [failureMessage, deferred, onAlert]);
    useEffect(() => {
        const setup = state.sshSetup;
        if (!setup) {
            notifiedSshSetup.current = undefined;
            return;
        }
        if (deferred || notifiedSshSetup.current === setup.message) return;
        notifiedSshSetup.current = setup.message;
        onAlert();
    }, [state.sshSetup, deferred, onAlert]);
}

function useProjectPicker(
    config: ReturnType<typeof useProject>['projectConfig'],
    onMissing: () => void,
) {
    const opened = useRef(false);
    useEffect(() => {
        if (!config || config.valid || opened.current) return;
        opened.current = true;
        onMissing();
    }, [config, onMissing]);
}

function useGenerationReset(reset: () => void, generation: string) {
    const previous = useRef(generation);
    useEffect(() => {
        if (previous.current === generation) return;
        previous.current = generation;
        reset();
    }, [reset, generation]);
}

function useGlobalKeys(params: {
    preference: ReturnType<
        typeof useSettings
    >['resolved']['loginAction']['value'];
    quickLogin: (action: LoginAction, reason?: string) => Promise<void>;
    project: ReturnType<typeof useProject>;
    overlayOpen: boolean;
    setTab: (update: (current: Tab) => Tab) => void;
    exit: () => void;
    ui: Pick<
        WorkspaceUi,
        | 'activeTab'
        | 'setLoginResult'
        | 'setLoginOpen'
        | 'setEnvironmentOpen'
        | 'setHelpOpen'
    >;
}) {
    const { preference, quickLogin, project, overlayOpen, setTab, exit, ui } =
        params;
    const [searching, setSearching] = useState(false);
    const shortcuts: Record<GlobalKeyAction, () => void> = {
        'quick-login': () => {
            if (preference === 'aws' || preference === 'registry')
                void quickLogin(preference);
        },
        'login-modal': () => {
            ui.setLoginResult(undefined);
            ui.setLoginOpen(true);
        },
        environment: () => ui.setEnvironmentOpen(true),
        help: () => ui.setHelpOpen(true),
        quit: exit,
    };
    useInput(
        (input, key) => {
            const context: GlobalKeyContext = {
                loginPreference: preference,
                tab: ui.activeTab,
                localInputReady:
                    ui.activeTab !== 'Modules' ||
                    (!project.loading && !project.error),
                searching,
            };
            const action = globalKeyAction(input, key, context);
            if (action) return shortcuts[action]();
            if (startsSearch(input, key, ui.activeTab)) {
                setSearching(true);
                return;
            }
            if (endsSearch(key)) setSearching(false);
            const modulesReady =
                ui.activeTab === 'Modules' &&
                !project.loading &&
                !project.error;
            const direction = tabDirection(input, key, modulesReady);
            if (direction !== null) {
                setSearching(false);
                setTab((current) => nextTab(current, direction));
                return;
            }
        },
        { isActive: !overlayOpen },
    );
}

function startsSearch(input: string, key: Key, tab: Tab) {
    return input === '/' && !key.ctrl && !key.meta && supportsSearch(tab);
}

function endsSearch(key: Key) {
    return key.escape || key.return;
}

export function useAppModel() {
    const client = useClient();
    const session = useSession();
    const ui = useWorkspaceUi();
    const { exit, suspendTerminal, waitUntilRenderFlush } = useApp();
    const { columns, rows } = useWindowSize();
    const project = useProject();
    const { projectConfig } = project;
    const settings = useSettings();
    const primaryProfile = settings.resolved.awsProfile.value;
    const configuredEcr = settings.resolved.ecrProfiles.value;
    const { status: aws, refresh: refreshAws } = useAwsStatus(ui.loginBusy);
    const runtimeStatus = useRuntimeStatus();
    const runtime = useRuntime(client, session);
    const live = useLive();
    const containerManager = useContainerManager(
        client,
        session.scope,
        projectConfig?.valid,
    );
    const discovery = useAwsDiscovery(
        projectConfig?.valid ? projectConfig.directory : undefined,
        primaryProfile,
        ui.activeTab === 'Config' || ui.loginOpen,
    );
    const workspace = {
        client,
        session,
        project,
        projectConfig,
        settings,
        primaryProfile,
        configuredEcr,
        aws,
        runtimeStatus,
        runtime,
        live,
        containerManager,
        discovery,
        environment: environmentFor(project, runtimeStatus, live.state),
        ecrPlan: ecrPlanFor(configuredEcr, discovery.discovery, primaryProfile),
    };
    const flows = useWorkspaceFlows(
        workspace,
        ui,
        { suspendTerminal, waitUntilRenderFlush },
        refreshAws,
        exit,
    );
    return { workspace, ui, flows, columns, rows };
}

export type WorkspaceData = ReturnType<typeof useAppModel>['workspace'];

function useWorkspaceFlows(
    workspace: WorkspaceData,
    ui: WorkspaceUi,
    terminal: TerminalControl,
    refreshAws: () => void,
    exit: () => void,
) {
    const { client, session, runtime } = workspace;
    const {
        login,
        quickLogin,
        notice: loginNotice,
    } = useLoginFlow({
        client,
        terminal,
        refreshAws,
        registryLogin: runtime.capabilities.registryLogin,
        ui,
    });
    const editors = useEditors({
        client,
        terminal,
        session,
        editing: !!ui.configEditor,
        refreshAws,
        ui,
    });
    useWorkspaceEffects(workspace, ui, quickLogin, exit);
    return { login, quickLogin, loginNotice, editors };
}

export type WorkspaceFlows = ReturnType<typeof useWorkspaceFlows>;

function useWorkspaceEffects(
    workspace: WorkspaceData,
    ui: WorkspaceUi,
    quickLogin: ReturnType<typeof useLoginFlow>['quickLogin'],
    exit: () => void,
) {
    const { settings, aws, live, projectConfig, session, project } = workspace;
    const {
        setActiveTab,
        setContainerRequest,
        setEnvironmentOpen,
        setConfigEditor,
        clearOverlays,
    } = ui;
    const openEnvironment = useCallback(
        () => setEnvironmentOpen(true),
        [setEnvironmentOpen],
    );
    const pickProject = useCallback(() => {
        setActiveTab('Config');
        setConfigEditor('project');
    }, [setActiveTab, setConfigEditor]);
    const reset = useCallback(() => {
        clearOverlays();
        setContainerRequest(undefined);
    }, [clearOverlays, setContainerRequest]);
    useAutoLogin(
        quickLogin,
        settings.resolved.autoLogin.value,
        aws.state,
        live.state,
        {
            loginOverlayOpen: ui.loginOverlayOpen,
            loginBusy: ui.loginBusy,
            environmentOpen: ui.environmentOpen,
            preference: settings.resolved.loginAction.value,
            interaction: session.interaction,
            connection: session.connection,
        },
    );
    useFailureAlerts(
        live.state,
        ui.loginOverlayOpen || ui.loginBusy,
        openEnvironment,
    );
    useProjectPicker(projectConfig, pickProject);
    useGenerationReset(reset, session.scope.generation);
    useGlobalKeys({
        preference: settings.resolved.loginAction.value,
        quickLogin,
        project,
        overlayOpen: ui.overlayOpen,
        setTab: ui.setActiveTab,
        exit,
        ui,
    });
}
