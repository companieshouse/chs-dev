import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type {
    WorkspaceData,
    WorkspaceFlows,
    WorkspaceUi,
} from '../app-model.js';
import ConfigScreen, { configRows } from './config-screen.js';
import ContainersScreen from './containers-screen.js';
import EnabledBrowser from './enabled-browser.js';
import KeyboardHints from './keyboard-hints.js';
import LogsScreen from './logs-screen.js';
import ModulesBrowser from './modules-browser.js';
import ServicesScreen from './services-screen.js';
import JourneysScreen from './journeys-screen.js';
import TabBar from './tab-bar.js';
import { screenHeight } from '../models/layout.js';
import { footerBindingsForTab } from '../models/keymap.js';
import { runtimeDisplayName } from '../models/formatting.js';
import { theme } from './theme.js';
import type { Tab } from '../models/navigation.js';

type ScreenEditors = WorkspaceFlows['editors'];

export function WorkspaceTabs({
    workspace,
    ui,
    editors,
    rows,
    columns,
}: {
    workspace: WorkspaceData;
    ui: WorkspaceUi;
    editors: ScreenEditors;
    rows: number;
    columns: number;
}) {
    const screens = screenProps(workspace, ui, editors, rows);
    return (
        <>
            <TabBar active={ui.activeTab} width={columns} />
            <WorkspaceFrame>
                <PrimaryScreens {...screens.primary} />
                <SecondaryScreens {...screens.secondary} />
                <TabHints activeTab={ui.activeTab} />
            </WorkspaceFrame>
        </>
    );
}

function screenProps(
    workspace: WorkspaceData,
    ui: WorkspaceUi,
    editors: ScreenEditors,
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
        session,
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
            usage: session.usage,
            logsView: ui.logsView,
        },
    };
}

function WorkspaceFrame({ children }: { children: ReactNode }) {
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
            {children}
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
    containerRequest: WorkspaceUi['containerRequest'];
    onService(name: string): void;
    onServiceContainers(name: string): void;
    onContainer(id: string): void;
    onSetting(key: Parameters<WorkspaceUi['setConfigEditor']>[0]): void;
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
                    height={screenHeight(rows, 'Services')}
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
                    height={screenHeight(rows, 'Containers')}
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
                    height={screenHeight(rows, 'Config')}
                    onEdit={onSetting}
                />
            )}
            <Box
                display={activeTab === 'Modules' ? 'flex' : 'none'}
                flexDirection="column"
            >
                <ModuleScreen
                    project={project}
                    active={activeTab === 'Modules' && !overlayOpen}
                    height={screenHeight(rows, 'Modules')}
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
    usage,
    activeTab,
    overlayOpen,
    logsView,
    rows,
    onService,
}: Pick<WorkspaceData, 'project' | 'runtimeStatus' | 'live' | 'environment'> & {
    usage: WorkspaceData['session']['usage'];
    activeTab: Tab;
    overlayOpen: boolean;
    logsView: WorkspaceUi['logsView'];
    rows: number;
    onService(name: string): void;
}) {
    const hidden = (tab: Tab) => ({
        display: activeTab === tab ? ('flex' as const) : ('none' as const),
        flexDirection: 'column' as const,
    });
    return (
        <>
            <Box {...hidden('Journeys')}>
                {projectGuard(project, 'Loading journeys…') ?? (
                    <JourneysScreen
                        active={activeTab === 'Journeys' && !overlayOpen}
                        height={screenHeight(rows, 'Journeys')}
                        groups={project.groups}
                        usage={usage}
                    />
                )}
            </Box>
            <Box {...hidden('Enabled')}>
                {projectGuard(
                    project,
                    'Loading enabled services…',
                    'Reading configuration…',
                ) ?? (
                    <EnabledBrowser
                        groups={project.groups}
                        details={project.details}
                        statuses={runtimeStatus.statuses}
                        defaultStatus={runtimeStatus.defaultStatus}
                        environment={environment}
                        active={activeTab === 'Enabled' && !overlayOpen}
                        height={screenHeight(rows, 'Enabled')}
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
                    height={screenHeight(rows, 'Logs')}
                />
            )}
        </>
    );
}

/** Loading/error placeholder for a project-backed screen, when applicable. */
function projectGuard(
    project: WorkspaceData['project'],
    loading: string,
    stateLoading?: string,
): ReactNode | undefined {
    if (project.loading) return <Text color={theme.foreground}>{loading}</Text>;
    if (project.error || project.stateError)
        return (
            <Text color={theme.error}>
                {project.error || project.stateError}
            </Text>
        );
    if (stateLoading && project.stateLoading)
        return <Text color={theme.foreground}>{stateLoading}</Text>;
    return undefined;
}

// Tabs whose screens render no footer of their own; every other screen pins
// its hints inside its TabScreen box.
const frameFooterTabs = new Set<Tab>(['Modules', 'Config']);

function TabHints({ activeTab }: { activeTab: Tab }) {
    if (!frameFooterTabs.has(activeTab)) return null;
    return (
        <>
            <Box flexGrow={1} />
            <KeyboardHints bindings={footerBindingsForTab(activeTab)} />
        </>
    );
}
