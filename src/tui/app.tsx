import { isActiveContainer } from '../domain/containers.js';
import type { Client, ClientSnapshot } from '../client/client.js';
import { containerClient } from '../client/environment.js';
import { interact } from '../client/interactions.js';
import { ClientProvider, useClient, useSession } from './context.js';
import type {
    OperationResult,
    RuntimeStrategy,
} from '../domain/runtime-strategy.js';
import type { ProfileDiscovery } from '../domain/aws-profiles.js';
import type { ServiceEdit } from '../domain/services.js';
import AwsLoginModal from './components/aws-login-modal.js';
import { autoLoginStep, initialAutoLoginMemory } from '../domain/auto-login.js';
import type { LoginAction, LoginResult } from '../domain/aws.js';
import { useAwsStatus } from './hooks/use-aws-status.js';
import StatusBar from './components/status-bar.js';
import { environmentSummary } from '../domain/environment.js';
import { theme } from './components/theme.js';
import KeyboardHints from './components/keyboard-hints.js';
import { Box, Text, useApp, useInput, useWindowSize, type Key } from 'ink';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import ConfigScreen, { configRows } from './components/config-screen.js';
import SettingEditor, {
    type SaveSetting,
} from './components/setting-editor.js';
import { handOverTerminal } from './components/terminal-handover.js';
import { useSettings } from './hooks/use-settings.js';
import { useAwsDiscovery } from './hooks/use-aws-discovery.js';
import type { SettingKey } from '../domain/settings.js';
import ServiceModal, {
    type ServiceContainerControls,
} from './components/service-modal.js';
import ModulesBrowser from './components/modules-browser.js';
import EnabledBrowser from './components/enabled-browser.js';
import { useProject } from './hooks/use-project.js';
import { useRuntimeStatus } from './hooks/use-runtime-status.js';
import { nextTab, tabDirection, type Tab } from './models/navigation.js';
import TabBar from './components/tab-bar.js';
import ServicesScreen from './components/services-screen.js';
import ContainersScreen, {
    type ContainerRequest,
} from './components/containers-screen.js';
import ContainerDetails from './components/container-details.js';
import { useLive } from './hooks/use-live.js';
import EnvironmentPanel from './components/environment-panel.js';
import SshSetupModal from './components/ssh-setup-modal.js';
import LogsScreen from './components/logs-screen.js';
import { safeLog } from '../domain/live-logs.js';
import type { LogFilter } from '../domain/log-view.js';
import type { LiveState } from '../domain/live.js';

function serviceContainer(state: LiveState, service: string) {
    const containers =
        state.observed?.containers.filter(
            (container) => container.service === service,
        ) ?? [];
    if (!containers.length) return undefined;
    return {
        active: containers.some((container) =>
            isActiveContainer(container.lifecycle),
        ),
        development: containers.some(
            (container) => container.mode === 'Development',
        ),
    };
}

type GlobalKeyAction = 'quick-login' | 'login-modal' | 'environment';
function globalKeyAction(
    input: string,
    key: Key,
    loginPreference: string | undefined,
): GlobalKeyAction | undefined {
    if (key.ctrl && input === 'l') {
        return loginPreference === 'aws' || loginPreference === 'registry'
            ? 'quick-login'
            : 'login-modal';
    }
    // Ctrl+R is the previous binding, kept as an alias.
    if (key.ctrl && (input === 'e' || input === 'r')) return 'environment';
    return undefined;
}

function runtimeDisplayName(name: string) {
    return name === 'Docker' ? 'Docker / Compose' : name;
}

function statusNotice(
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

type TerminalControl = Pick<
    ReturnType<typeof useApp>,
    'suspendTerminal' | 'waitUntilRenderFlush'
>;

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
    const [modalService, setModalService] = useState<string>();
    const [selectedContainer, setSelectedContainer] = useState<string>();
    const [containerRequest, setContainerRequest] =
        useState<ContainerRequest>();
    const [loginOpen, setLoginOpen] = useState(false);
    const [environmentOpen, setEnvironmentOpen] = useState(false);
    const [sshSetupOpen, setSshSetupOpen] = useState(false);
    const [logsView, setLogsView] = useState<{
        id: number;
        filter: LogFilter;
        source: 'tui' | 'live';
    }>({ id: 0, filter: 'All', source: 'tui' });
    const [loginBusy, setLoginBusy] = useState(false);
    const [loginResult, setLoginResult] = useState<LoginResult>();
    const [configEditor, setConfigEditor] = useState<SettingKey>();
    const loginOverlayOpen =
        !!modalService ||
        !!selectedContainer ||
        loginOpen ||
        sshSetupOpen ||
        !!configEditor;
    return {
        activeTab,
        setActiveTab,
        modalService,
        setModalService,
        selectedContainer,
        setSelectedContainer,
        containerRequest,
        setContainerRequest,
        loginOpen,
        setLoginOpen,
        environmentOpen,
        setEnvironmentOpen,
        sshSetupOpen,
        setSshSetupOpen,
        logsView,
        setLogsView,
        loginBusy,
        setLoginBusy,
        loginResult,
        setLoginResult,
        configEditor,
        setConfigEditor,
        loginOverlayOpen,
        overlayOpen: loginOverlayOpen || environmentOpen,
        openServiceContainers(service: string) {
            setModalService(undefined);
            setActiveTab('Containers');
            setContainerRequest((previous) => ({
                service,
                sequence: (previous?.sequence ?? 0) + 1,
            }));
        },
    };
}
type WorkspaceUi = ReturnType<typeof useWorkspaceUi>;

type LoginFlowParams = {
    client: Client;
    terminal: TerminalControl;
    refreshAws: () => void;
    registryLogin: boolean;
    ui: Pick<
        WorkspaceUi,
        | 'setLoginBusy'
        | 'setLoginResult'
        | 'setEnvironmentOpen'
        | 'setLoginOpen'
    >;
};
async function performLogin(
    client: Client,
    action: LoginAction,
    reason?: string,
) {
    if (reason)
        process.stdout.write(
            `\nchs-dev: ${reason} Logging in automatically (Ctrl+C cancels).\n\n`,
        );
    return interact(client, 'authentication.login', {
        action,
        automatic: !!reason,
    });
}

function useLoginWork(params: LoginFlowParams) {
    const { client, terminal, refreshAws, ui } = params;
    const { setLoginBusy, setLoginResult } = ui;
    const { suspendTerminal, waitUntilRenderFlush } = terminal;
    const running = useRef(false);
    const loginWork = useCallback(
        async (
            action: LoginAction,
            reason?: string,
        ): Promise<LoginResult | undefined> => {
            if (running.current) return;
            running.current = true;
            setLoginBusy(true);
            setLoginResult(undefined);
            let result: LoginResult | undefined;
            try {
                await handOverTerminal(
                    { suspendTerminal, waitUntilRenderFlush },
                    async () => {
                        result = await performLogin(client, action, reason);
                    },
                );
                setLoginResult(result);
                refreshAws();
                return result;
            } catch (error) {
                result = {
                    outcome: 'failed',
                    message:
                        error instanceof Error ? error.message : String(error),
                };
                setLoginResult(result);
                return result;
            } finally {
                running.current = false;
                setLoginBusy(false);
            }
        },
        [
            client,
            refreshAws,
            setLoginBusy,
            setLoginResult,
            suspendTerminal,
            waitUntilRenderFlush,
        ],
    );
    return { loginWork, running };
}
function useLoginFlow(params: LoginFlowParams) {
    const { registryLogin } = params;
    const { setEnvironmentOpen, setLoginOpen } = params.ui;
    const { loginWork, running } = useLoginWork(params);
    const [notice, setNotice] = useState<{
        text: string;
        tone: 'success' | 'muted';
    }>();
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(undefined), 8000);
        return () => clearTimeout(timer);
    }, [notice]);

    const login = loginWork;
    /** Runs a login without the modal; failures open it to show the result. */
    const quickLogin = useCallback(
        async (action: LoginAction, reason?: string) => {
            if (running.current) return;
            const effective =
                action === 'registry' && !registryLogin ? 'aws' : action;
            setNotice(undefined);
            const result = await login(effective, reason);
            if (!result || result.outcome === 'failed') {
                setEnvironmentOpen(false);
                setLoginOpen(true);
                return;
            }
            setNotice({
                text: result.message,
                tone: result.outcome === 'success' ? 'success' : 'muted',
            });
        },
        [login, running, registryLogin, setEnvironmentOpen, setLoginOpen],
    );
    return { login, quickLogin, notice };
}

function useEditors(params: {
    client: Client;
    terminal: TerminalControl;
    session: ClientSnapshot;
    editing: boolean;
    refreshAws: () => void;
    ui: Pick<WorkspaceUi, 'setConfigEditor' | 'setModalService'>;
}) {
    const editRevision = useRef({
        settings: params.session.settingsRevision,
        configuration: params.session.configurationRevision,
    });
    const openSetting = (key: SettingKey) => {
        editRevision.current.settings = params.session.settingsRevision;
        params.ui.setConfigEditor(key);
    };
    const openService = (name: string) => {
        editRevision.current.configuration =
            params.session.configurationRevision;
        params.ui.setModalService(name);
    };
    const saveSetting: SaveSetting = async (key, value) => {
        await params.client.command('settings.save', {
            key,
            value,
            revision: params.editing
                ? editRevision.current.settings
                : params.session.settingsRevision,
        });
        if (key === 'awsProfile') params.refreshAws();
    };
    const cloneProject = async (
        destination: string,
    ): Promise<OperationResult> => {
        let result: OperationResult = {
            outcome: 'cancelled',
            message: 'Clone cancelled.',
        };
        await handOverTerminal(params.terminal, async () => {
            result = await interact(params.client, 'project.clone', {
                destination,
            });
        });
        return result;
    };
    const saveConfiguration = async (edit: ServiceEdit) => {
        await params.client.command('configuration.save', {
            edit,
            revision: editRevision.current.configuration,
        });
    };
    return {
        openSetting,
        openService,
        saveSetting,
        cloneProject,
        saveConfiguration,
    };
}

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
    // Without a usable project, open Config and the picker once at startup.
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
        'activeTab' | 'setLoginResult' | 'setLoginOpen' | 'setEnvironmentOpen'
    >;
}) {
    const { preference, quickLogin, project, overlayOpen, setTab, exit, ui } =
        params;
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
    };
    useInput(
        (input, key) => {
            const action = globalKeyAction(input, key, preference);
            if (action) return shortcuts[action]();
            const modulesReady =
                ui.activeTab === 'Modules' &&
                !project.loading &&
                !project.error;
            const direction = tabDirection(input, key, modulesReady);
            if (direction !== null) {
                setTab((current) => nextTab(current, direction));
                return;
            }
            // Screens with search or panel focus own their Escape and quit behaviour.
            if (
                ['Services', 'Containers', 'Logs'].includes(ui.activeTab) ||
                modulesReady
            )
                return;
            if (input === 'q' || key.escape) exit();
        },
        { isActive: !overlayOpen },
    );
}

function useAppModel() {
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
type WorkspaceData = ReturnType<typeof useAppModel>['workspace'];
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
function useWorkspaceEffects(
    workspace: WorkspaceData,
    ui: WorkspaceUi,
    quickLogin: ReturnType<typeof useLoginFlow>['quickLogin'],
    exit: () => void,
) {
    const { settings, aws, live, projectConfig, session, project } = workspace;
    const {
        setEnvironmentOpen,
        setActiveTab,
        setConfigEditor,
        setModalService,
        setSelectedContainer,
        setContainerRequest,
        setSshSetupOpen,
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
        setModalService(undefined);
        setSelectedContainer(undefined);
        setConfigEditor(undefined);
        setContainerRequest(undefined);
        setSshSetupOpen(false);
        setEnvironmentOpen(false);
    }, [
        setModalService,
        setSelectedContainer,
        setConfigEditor,
        setContainerRequest,
        setSshSetupOpen,
        setEnvironmentOpen,
    ]);
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
export default function App({ client }: { client: Client }) {
    return (
        <ClientProvider value={client}>
            <AppView />
        </ClientProvider>
    );
}
function AppView() {
    const { workspace, ui, flows, columns, rows } = useAppModel();
    const screens = screenProps(workspace, ui, flows.editors, rows);
    const status = statusProps(workspace, ui.loginBusy, flows.loginNotice);
    return (
        <Box
            width={columns}
            height={rows}
            flexDirection="column"
            backgroundColor={theme.background}
        >
            <Box
                display={ui.selectedContainer ? 'none' : 'flex'}
                flexDirection="column"
                flexGrow={1}
            >
                <WorkspaceTabs screens={screens} columns={columns} />
                <StatusBar {...status} />
            </Box>
            <EnvironmentOverlays
                live={workspace.live}
                environment={workspace.environment}
                environmentOpen={ui.environmentOpen}
                sshSetupOpen={ui.sshSetupOpen}
                onEnvironment={ui.setEnvironmentOpen}
                onSshSetup={ui.setSshSetupOpen}
                onTab={ui.setActiveTab}
                onLogs={ui.setLogsView}
                quickLogin={flows.quickLogin}
                saveSetting={flows.editors.saveSetting}
            />
            <LoginOverlays
                runtime={workspace.runtime}
                aws={workspace.aws}
                settings={workspace.settings}
                projectConfig={workspace.projectConfig}
                discovery={workspace.discovery}
                primaryProfile={workspace.primaryProfile}
                ecrPlan={workspace.ecrPlan}
                loginOpen={ui.loginOpen}
                loginBusy={ui.loginBusy}
                loginResult={ui.loginResult}
                configEditor={ui.configEditor}
                onLoginOpen={ui.setLoginOpen}
                onConfigEditor={ui.setConfigEditor}
                login={flows.login}
                quickLogin={flows.quickLogin}
                editors={flows.editors}
            />
            <ContainerScreen
                selectedContainer={ui.selectedContainer}
                containerManager={workspace.containerManager}
                live={workspace.live}
                onClose={() => ui.setSelectedContainer(undefined)}
            />
            <ServiceOverlay
                modalService={ui.modalService}
                containerManager={workspace.containerManager}
                project={workspace.project}
                live={workspace.live}
                onClose={() => ui.setModalService(undefined)}
                onContainer={ui.openServiceContainers}
                saveConfiguration={flows.editors.saveConfiguration}
            />
        </Box>
    );
}

function statusProps(
    workspace: Pick<
        WorkspaceData,
        | 'aws'
        | 'primaryProfile'
        | 'runtime'
        | 'live'
        | 'environment'
        | 'session'
        | 'settings'
    >,
    loginBusy: boolean,
    loginNotice: ReturnType<typeof useLoginFlow>['notice'],
) {
    return {
        aws: workspace.aws,
        profileName: workspace.primaryProfile,
        runtimeName: runtimeDisplayName(workspace.runtime.name),
        live: workspace.live.state,
        environment: workspace.environment,
        available: !!workspace.live.controller,
        notice: statusNotice(loginBusy, workspace.session, loginNotice),
        restartRequired: workspace.settings.restartPending.length > 0,
    };
}

function WorkspaceTabs({
    screens,
    columns,
}: {
    screens: ReturnType<typeof screenProps>;
    columns: number;
}) {
    const activeTab = screens.primary.activeTab;
    return (
        <>
            <TabBar active={activeTab} width={columns} />
            <WorkspaceFrame>
                <PrimaryScreens {...screens.primary} />
                <SecondaryScreens {...screens.secondary} />
                <TabHints activeTab={activeTab} />
            </WorkspaceFrame>
        </>
    );
}

function screenProps(
    workspace: WorkspaceData,
    ui: WorkspaceUi,
    editors: ReturnType<typeof useEditors>,
    rows: number,
) {
    const {
        project,
        runtimeStatus,
        runtime,
        containerManager,
        settings,
        discovery,
        live,
        environment,
    } = workspace;
    const navigation = {
        activeTab: ui.activeTab,
        overlayOpen: ui.overlayOpen,
        rows,
        onService: editors.openService,
    };
    return {
        primary: {
            ...navigation,
            project,
            runtimeStatus,
            runtime,
            containerManager,
            settings,
            discovery,
            containerRequest: ui.containerRequest,
            onServiceContainers: ui.openServiceContainers,
            onContainer: ui.setSelectedContainer,
            onSetting: editors.openSetting,
        },
        secondary: {
            ...navigation,
            project,
            runtimeStatus,
            live,
            environment,
            logsView: ui.logsView,
        },
    };
}

function WorkspaceFrame(props: { children: ReactNode }) {
    return (
        <Box
            flexGrow={1}
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.border}
            borderTop={false}
            paddingX={2}
            paddingBottom={1}
        >
            {props.children}
        </Box>
    );
}

type PrimaryProps = Pick<
    WorkspaceData,
    | 'project'
    | 'runtimeStatus'
    | 'runtime'
    | 'containerManager'
    | 'settings'
    | 'discovery'
> & {
    rows: number;
    activeTab: Tab;
    overlayOpen: boolean;
    containerRequest: ContainerRequest | undefined;
    onService(name: string): void;
    onServiceContainers(name: string): void;
    onContainer(id: string): void;
    onSetting(key: SettingKey): void;
};
function PrimaryScreens(props: PrimaryProps) {
    const {
        project,
        runtimeStatus,
        runtime,
        containerManager,
        settings,
        discovery,
        activeTab,
        overlayOpen,
        rows,
        onService,
        onServiceContainers,
        onContainer,
        onSetting,
        containerRequest,
    } = props;
    return (
        <>
            <Box
                display={activeTab === 'Services' ? 'flex' : 'none'}
                flexDirection="column"
            >
                <ServicesScreen
                    {...project}
                    {...runtimeStatus}
                    runtimeName={runtimeDisplayName(runtime.name)}
                    active={activeTab === 'Services' && !overlayOpen}
                    height={Math.max(4, rows - 6)}
                    onOpen={onService}
                    onContainer={onServiceContainers}
                />
            </Box>
            <Box
                display={activeTab === 'Containers' ? 'flex' : 'none'}
                flexDirection="column"
            >
                <ContainersScreen
                    manager={containerManager}
                    active={activeTab === 'Containers' && !overlayOpen}
                    height={Math.max(4, rows - 6)}
                    request={containerRequest}
                    onOpen={onContainer}
                />
            </Box>
            {activeTab === 'Config' && (
                <ConfigScreen
                    rows={configRows(
                        settings,
                        project.projectConfig,
                        discovery.discovery,
                    )}
                    settings={settings}
                    active={!overlayOpen}
                    height={Math.max(4, rows - 8)}
                    onEdit={onSetting}
                    onStartEngine={
                        runtime.startService
                            ? () => runtime.startService!()
                            : undefined
                    }
                />
            )}
            <Box
                display={activeTab === 'Modules' ? 'flex' : 'none'}
                flexDirection="column"
            >
                <ModuleScreen
                    project={project}
                    active={activeTab === 'Modules' && !overlayOpen}
                    height={Math.max(6, rows - 8)}
                    onOpen={onService}
                />
            </Box>
        </>
    );
}

function ModuleScreen({
    project,
    ...props
}: {
    project: WorkspaceData['project'];
    active: boolean;
    height: number;
    onOpen(name: string): void;
}) {
    if (project.loading)
        return <Text color={theme.foreground}>Loading modules…</Text>;
    if (project.error) return <Text color={theme.error}>{project.error}</Text>;
    return <ModulesBrowser groups={project.groups} {...props} />;
}

function SecondaryScreens({
    project,
    runtimeStatus,
    live,
    environment,
    activeTab,
    overlayOpen,
    logsView,
    rows,
    onService,
}: Pick<WorkspaceData, 'project' | 'runtimeStatus' | 'live' | 'environment'> & {
    activeTab: Tab;
    overlayOpen: boolean;
    logsView: WorkspaceUi['logsView'];
    rows: number;
    onService(name: string): void;
}) {
    return (
        <>
            <Box
                display={activeTab === 'Enabled' ? 'flex' : 'none'}
                flexDirection="column"
                marginTop={1}
            >
                {project.loading ? (
                    <Text color={theme.foreground}>
                        Loading enabled services…
                    </Text>
                ) : project.error || project.stateError ? (
                    <Text color={theme.error}>
                        {project.error || project.stateError}
                    </Text>
                ) : project.stateLoading ? (
                    <Text color={theme.foreground}>Reading configuration…</Text>
                ) : (
                    <EnabledBrowser
                        groups={project.groups}
                        details={project.details}
                        statuses={runtimeStatus.statuses}
                        defaultStatus={runtimeStatus.defaultStatus}
                        environment={environment}
                        active={activeTab === 'Enabled' && !overlayOpen}
                        height={Math.max(2, rows - 9)}
                        onOpen={onService}
                    />
                )}
            </Box>
            {activeTab === 'Logs' && (
                <LogsScreen
                    key={logsView.id}
                    initialFilter={logsView.filter}
                    initialSource={logsView.source}
                    state={live.state}
                    active={!overlayOpen}
                    height={Math.max(3, rows - 9)}
                />
            )}
        </>
    );
}

function TabHints({ activeTab }: { activeTab: Tab }) {
    if (activeTab === 'Services' || activeTab === 'Containers') return null;
    return (
        <>
            <Box flexGrow={1} />
            {activeTab === 'Modules' ? (
                <Box flexDirection="column">
                    <KeyboardHints>
                        ↑ ↓ browse · ← → tabs · Tab panel · Enter expand/actions
                    </KeyboardHints>
                    <KeyboardHints>
                        / filter · d depends on · u used by · q quit
                    </KeyboardHints>
                </Box>
            ) : activeTab === 'Enabled' ? (
                <KeyboardHints>
                    ↑ ↓ browse · Enter actions · ← → / Tab tabs · q quit
                </KeyboardHints>
            ) : activeTab === 'Config' ? (
                <KeyboardHints>
                    ↑ ↓ choose · Enter edit · ← → / Tab tabs · q quit
                </KeyboardHints>
            ) : activeTab === 'Logs' ? (
                <Box flexDirection="column">
                    <KeyboardHints>
                        c filter · / search · v detail · r raw · s source
                    </KeyboardHints>
                    <KeyboardHints>
                        ↑ ↓ PgUp PgDn scroll · f follow · ← → / Tab tabs · q
                        quit
                    </KeyboardHints>
                </Box>
            ) : (
                <KeyboardHints>← → / Tab tabs · q quit</KeyboardHints>
            )}
        </>
    );
}

function EnvironmentOverlays({
    live,
    environment,
    environmentOpen,
    sshSetupOpen,
    onEnvironment,
    onSshSetup,
    onTab,
    onLogs,
    quickLogin,
    saveSetting,
}: Pick<WorkspaceData, 'live' | 'environment'> & {
    environmentOpen: boolean;
    sshSetupOpen: boolean;
    onEnvironment: WorkspaceUi['setEnvironmentOpen'];
    onSshSetup: WorkspaceUi['setSshSetupOpen'];
    onTab: WorkspaceUi['setActiveTab'];
    onLogs: WorkspaceUi['setLogsView'];
    quickLogin: ReturnType<typeof useLoginFlow>['quickLogin'];
    saveSetting: SaveSetting;
}) {
    return (
        <>
            {environmentOpen && (
                <EnvironmentPanel
                    controller={live.controller}
                    state={live.state}
                    summary={environment}
                    onClose={() => onEnvironment(false)}
                    onSetupSsh={() => {
                        onEnvironment(false);
                        onSshSetup(true);
                    }}
                    onLogin={(kind) => {
                        void quickLogin(kind);
                    }}
                    onViewLogs={(problems) => {
                        onEnvironment(false);
                        onLogs((current) => ({
                            id: current.id + 1,
                            filter: problems ? 'Problems' : 'All',
                            source: 'live',
                        }));
                        onTab('Logs');
                    }}
                    onAutoApply={(value) => {
                        // Failures are recorded by the settings.save operation log.
                        saveSetting('autoApply', value).catch(() => undefined);
                    }}
                />
            )}
            {sshSetupOpen && live.state.sshSetup && live.controller && (
                <SshSetupModal
                    status={live.state.sshSetup}
                    errorMessage={live.state.message}
                    onSetup={async (input) => {
                        const success = await live.controller!.setupSsh(input);
                        if (success) {
                            onSshSetup(false);
                            onEnvironment(true);
                        }
                        return success;
                    }}
                    onClose={() => onSshSetup(false)}
                />
            )}
        </>
    );
}

function LoginOverlays({
    runtime,
    aws,
    settings,
    projectConfig,
    discovery,
    primaryProfile,
    ecrPlan,
    loginOpen,
    loginBusy,
    loginResult,
    configEditor,
    onLoginOpen,
    onConfigEditor,
    login,
    quickLogin,
    editors,
}: Pick<
    WorkspaceData,
    | 'runtime'
    | 'aws'
    | 'settings'
    | 'projectConfig'
    | 'discovery'
    | 'primaryProfile'
    | 'ecrPlan'
> & {
    loginOpen: boolean;
    loginBusy: boolean;
    loginResult: LoginResult | undefined;
    configEditor: SettingKey | undefined;
    onLoginOpen: WorkspaceUi['setLoginOpen'];
    onConfigEditor: WorkspaceUi['setConfigEditor'];
    login: ReturnType<typeof useLoginFlow>['login'];
    quickLogin: ReturnType<typeof useLoginFlow>['quickLogin'];
    editors: ReturnType<typeof useEditors>;
}) {
    return (
        <>
            {loginOpen && (
                <AwsLoginModal
                    runtime={runtime}
                    profile={primaryProfile}
                    ecr={ecrPlan}
                    busy={loginBusy}
                    result={loginResult}
                    aws={aws}
                    onLogin={(action, remember) => {
                        if (!remember) {
                            void login(action);
                            return;
                        }
                        // Failures are recorded by the settings.save operation log.
                        editors
                            .saveSetting('loginAction', action)
                            .catch(() => undefined);
                        onLoginOpen(false);
                        void quickLogin(action);
                    }}
                    onClose={() => onLoginOpen(false)}
                />
            )}
            {configEditor && (
                <SettingEditor
                    setting={configEditor}
                    settings={settings}
                    projectDirectory={projectConfig?.directory}
                    discovery={discovery}
                    save={editors.saveSetting}
                    clone={editors.cloneProject}
                    onClose={() => onConfigEditor(undefined)}
                />
            )}
        </>
    );
}

function ContainerScreen({
    selectedContainer,
    containerManager,
    live,
    onClose,
}: Pick<WorkspaceData, 'containerManager' | 'live'> & {
    selectedContainer: string | undefined;
    onClose(): void;
}) {
    if (!selectedContainer || !containerManager) return null;
    return (
        <ContainerDetails
            key={selectedContainer}
            id={selectedContainer}
            manager={containerManager}
            environmentBusy={live.state.busy}
            onClose={() => {
                onClose();
                void live.controller?.poll();
            }}
            onAction={async (container, action) => {
                if (live.controller)
                    return live.controller.manageContainer(
                        containerManager,
                        container,
                        action,
                    );
                const result = await containerManager.action(
                    action,
                    container,
                    {},
                );
                return {
                    ok: result.outcome === 'success',
                    message: result.message,
                };
            }}
        />
    );
}
function serviceSaveHint(live: WorkspaceData['live']) {
    if (!live.controller)
        return 'Saves configuration only; containers are unchanged.';
    if (!live.state.running)
        return 'Saved changes apply when you start the environment (Ctrl+E).';
    return live.state.autoApply
        ? 'Saving applies the change to the running environment.'
        : 'Auto-apply is off: apply saved changes from Ctrl+E.';
}

function serviceControls(
    live: WorkspaceData['live'],
    name: string,
): ServiceContainerControls | undefined {
    const controller = live.controller;
    if (!controller) return undefined;

    return {
        container: serviceContainer(live.state, name),
        busy: live.state.busy,
        action: (action) => controller.serviceAction([name], action),
        reload: () => controller.reloadService(name),
        logs: (tail, signal) => controller.serviceLogs(name, tail, signal),
    };
}

function ServiceOverlay({
    modalService,
    containerManager,
    project,
    live,
    onClose,
    onContainer,
    saveConfiguration,
}: Pick<WorkspaceData, 'containerManager' | 'project' | 'live'> & {
    modalService: string | undefined;
    onClose(): void;
    onContainer(name: string): void;
    saveConfiguration(edit: ServiceEdit): Promise<void>;
}) {
    if (!modalService || !project.projectConfig) return null;
    return (
        <ServiceModal
            key={`${modalService}:${project.details[modalService]?.enabled}:${project.details[modalService]?.mode}`}
            name={modalService}
            onContainer={
                containerManager ? () => onContainer(modalService) : undefined
            }
            details={project.details[modalService]}
            allDetails={project.details}
            groups={project.groups}
            onClose={() => onClose()}
            onApply={async (edit) => {
                await saveConfiguration(edit);
            }}
            applyOnSave={
                !!live.controller && live.state.running && live.state.autoApply
            }
            saveHint={serviceSaveHint(live)}
            controls={serviceControls(live, modalService)}
        />
    );
}
