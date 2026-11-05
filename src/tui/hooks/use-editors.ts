import type { Client, ClientSnapshot } from '../../client/client.js';
import { interact } from '../../client/interactions.js';
import type { OperationResult } from '../../domain/runtime-strategy.js';
import type { ServiceEdit } from '../../domain/services.js';
import type { SettingKey } from '../../domain/settings.js';
import type { SaveSetting } from '../components/setting-editor.js';
import { handOverTerminal } from '../components/terminal-handover.js';
import type { TerminalControl } from './use-login-flow.js';
import { useRef } from 'react';

export interface EditorUi {
    setConfigEditor(key: SettingKey): void;
    setModalService(name: string): void;
}

export interface EditorParams {
    client: Client;
    terminal: TerminalControl;
    session: ClientSnapshot;
    editing: boolean;
    refreshAws(): void;
    ui: EditorUi;
}

export function useEditors(params: EditorParams) {
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

export type Editors = ReturnType<typeof useEditors>;
