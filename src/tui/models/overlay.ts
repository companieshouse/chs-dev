import type { SettingKey } from '../../domain/settings.js';

export type WorkspaceOverlay =
    | { kind: 'service'; name: string }
    | { kind: 'container'; id: string }
    | { kind: 'login' }
    | { kind: 'environment' }
    | { kind: 'ssh' }
    | { kind: 'setting'; key: SettingKey }
    | { kind: 'help' };

export function overlayView(activeOverlay: WorkspaceOverlay | undefined) {
    let modalService: string | undefined;
    let selectedContainer: string | undefined;
    let loginOpen = false;
    let environmentOpen = false;
    let sshSetupOpen = false;
    let configEditor: SettingKey | undefined;
    let helpOpen = false;
    switch (activeOverlay?.kind) {
        case 'service':
            modalService = activeOverlay.name;
            break;
        case 'container':
            selectedContainer = activeOverlay.id;
            break;
        case 'login':
            loginOpen = true;
            break;
        case 'environment':
            environmentOpen = true;
            break;
        case 'ssh':
            sshSetupOpen = true;
            break;
        case 'setting':
            configEditor = activeOverlay.key;
            break;
        case 'help':
            helpOpen = true;
            break;
    }
    return {
        modalService,
        selectedContainer,
        loginOpen,
        environmentOpen,
        sshSetupOpen,
        configEditor,
        helpOpen,
    };
}
