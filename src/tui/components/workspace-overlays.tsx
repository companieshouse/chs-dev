import type {
    WorkspaceData,
    WorkspaceFlows,
    WorkspaceUi,
} from '../app-model.js';
import { isActiveContainer } from '../../domain/containers.js';
import type { LoginAction } from '../../domain/aws.js';
import type { ServiceEdit } from '../../domain/services.js';
import HelpModal from './help-modal.js';
import LoginModal from './aws-login-modal.js';
import ContainerDetails from './container-details.js';
import EnvironmentPanel from './environment-panel.js';
import SshSetupModal from './ssh-setup-modal.js';
import SettingEditor from './setting-editor.js';
import ServiceModal, {
    type ServiceContainerControls,
} from './service-modal.js';
import { bindingsForTab } from '../models/keymap.js';
import type { LiveState } from '../../domain/live.js';

export function WorkspaceOverlays({
    workspace,
    ui,
    flows,
}: {
    workspace: WorkspaceData;
    ui: WorkspaceUi;
    flows: WorkspaceFlows;
}) {
    return (
        <>
            <EnvironmentOverlays
                workspace={workspace}
                ui={ui}
                quickLogin={flows.quickLogin}
                saveSetting={flows.editors.saveSetting}
            />
            {ui.helpOpen && (
                <HelpModal
                    bindings={bindingsForTab(ui.activeTab)}
                    onClose={() => ui.setHelpOpen(false)}
                />
            )}
            <LoginOverlays
                workspace={workspace}
                ui={ui}
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
        </>
    );
}

function EnvironmentOverlays({
    workspace,
    ui,
    quickLogin,
    saveSetting,
}: {
    workspace: WorkspaceData;
    ui: WorkspaceUi;
    quickLogin: WorkspaceFlows['quickLogin'];
    saveSetting: WorkspaceFlows['editors']['saveSetting'];
}) {
    const { live, environment } = workspace;
    return (
        <>
            {ui.environmentOpen && (
                <EnvironmentPanel
                    controller={live.controller}
                    state={live.state}
                    summary={environment}
                    statuses={workspace.runtimeStatus.statuses}
                    groups={workspace.project.groups}
                    onClose={() => ui.setEnvironmentOpen(false)}
                    onSetupSsh={() => {
                        ui.setEnvironmentOpen(false);
                        ui.setSshSetupOpen(true);
                    }}
                    onLogin={(kind) => {
                        void quickLogin(kind);
                    }}
                    onViewLogs={(problems) => {
                        ui.setEnvironmentOpen(false);
                        ui.setLogsView((current) => ({
                            id: current.id + 1,
                            filter: problems ? 'Problems' : 'All',
                            source: 'live',
                        }));
                        ui.setActiveTab('Logs');
                    }}
                    onAutoApply={(value) => saveSetting('autoApply', value)}
                />
            )}
            {ui.sshSetupOpen && live.state.sshSetup && live.controller && (
                <SshSetupModal
                    status={live.state.sshSetup}
                    errorMessage={live.state.message}
                    onSetup={async (input) => {
                        const success = await live.controller!.setupSsh(input);
                        if (success) {
                            ui.setSshSetupOpen(false);
                            ui.setEnvironmentOpen(true);
                        }
                        return success;
                    }}
                    onClose={() => ui.setSshSetupOpen(false)}
                />
            )}
        </>
    );
}

function LoginOverlays({
    workspace,
    ui,
    login,
    quickLogin,
    editors,
}: {
    workspace: WorkspaceData;
    ui: WorkspaceUi;
    login: WorkspaceFlows['login'];
    quickLogin: WorkspaceFlows['quickLogin'];
    editors: WorkspaceFlows['editors'];
}) {
    const {
        runtime,
        aws,
        settings,
        projectConfig,
        discovery,
        primaryProfile,
        ecrPlan,
    } = workspace;
    return (
        <>
            {ui.loginOpen && (
                <LoginModal
                    runtime={runtime}
                    profile={primaryProfile}
                    ecr={ecrPlan}
                    busy={ui.loginBusy}
                    result={ui.loginResult}
                    aws={aws}
                    onLogin={(action, remember) => {
                        if (!remember) {
                            void login(action);
                            return;
                        }
                        rememberLogin(
                            action,
                            editors,
                            ui.setLoginOpen,
                            ui.setLoginResult,
                            quickLogin,
                        );
                    }}
                    onClose={() => ui.setLoginOpen(false)}
                />
            )}
            {ui.configEditor && (
                <SettingEditor
                    setting={ui.configEditor}
                    settings={settings}
                    projectDirectory={projectConfig?.directory}
                    discovery={discovery}
                    save={editors.saveSetting}
                    clone={editors.cloneProject}
                    onClose={() => ui.setConfigEditor(undefined)}
                />
            )}
        </>
    );
}

function rememberLogin(
    action: LoginAction,
    editors: WorkspaceFlows['editors'],
    onLoginOpen: WorkspaceUi['setLoginOpen'],
    setLoginResult: WorkspaceUi['setLoginResult'],
    quickLogin: WorkspaceFlows['quickLogin'],
) {
    void editors.saveSetting('loginAction', action).then(
        () => {
            onLoginOpen(false);
            void quickLogin(action);
        },
        (error: unknown) =>
            setLoginResult({
                outcome: 'failed',
                message: error instanceof Error ? error.message : String(error),
            }),
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
