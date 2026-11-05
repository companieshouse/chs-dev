import type { Client } from '../client/client.js';
import { ClientProvider } from './context.js';
import StatusBar from './components/status-bar.js';
import { theme } from './components/theme.js';
import { Box } from 'ink';
import { runtimeDisplayName } from './models/formatting.js';
import { WorkspaceTabs } from './components/workspace-screens.js';
import { WorkspaceOverlays } from './components/workspace-overlays.js';
import {
    statusNotice,
    useAppModel,
    type WorkspaceData,
    type WorkspaceFlows,
} from './app-model.js';

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
    loginNotice: WorkspaceFlows['loginNotice'],
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

function AppView() {
    const { workspace, ui, flows, columns, rows } = useAppModel();
    const status = statusProps(workspace, ui.loginBusy, flows.loginNotice);
    return (
        <Box
            width={columns}
            height={rows}
            flexDirection="column"
            backgroundColor={theme.background}
        >
            <Box
                display={ui.overlayOpen ? 'none' : 'flex'}
                flexDirection="column"
                flexGrow={1}
            >
                <WorkspaceTabs
                    workspace={workspace}
                    ui={ui}
                    editors={flows.editors}
                    rows={rows}
                    columns={columns}
                />
                <StatusBar {...status} />
            </Box>
            <WorkspaceOverlays workspace={workspace} ui={ui} flows={flows} />
        </Box>
    );
}

export default function App({ client }: { client: Client }) {
    return (
        <ClientProvider value={client}>
            <AppView />
        </ClientProvider>
    );
}
