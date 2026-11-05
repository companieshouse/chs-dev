import type { AutoLoginMode } from '../../domain/auto-login.js';
import {
    settingEnvironment,
    type LoginChoice,
    type SettingKey,
    type SettingValues,
} from '../../domain/settings.js';
import type { OperationResult } from '../../domain/runtime-strategy.js';
import type { ProfileDiscovery } from '../../domain/aws-profiles.js';
import { supportedRuntimes } from '../../domain/settings.js';
import type {
    ResolvedSetting,
    SettingsSnapshot,
} from '../../domain/settings.js';
import ProjectPickerModal from './project-picker-modal.js';
import {
    ChoiceModal,
    ProfileChecklistModal,
    TextInputModal,
} from './settings-modals.js';

export type SaveSetting = <K extends SettingKey>(
    key: K,
    value: SettingValues[K] | undefined,
) => Promise<void>;

type SettingEditorProps = {
    setting: SettingKey;
    settings: SettingsSnapshot;
    projectDirectory: string | undefined;
    discovery: { discovery?: ProfileDiscovery; error?: string };
    save: SaveSetting;
    clone(destination: string): Promise<OperationResult>;
    onClose(): void;
};

function envOverride(resolved: ResolvedSetting<unknown>): string | undefined {
    return resolved.source === 'env'
        ? `${resolved.environment} is set, so its value stays active until it is unset.`
        : undefined;
}

function restartNotice(setting: SettingKey): string | undefined {
    return setting === 'project' ||
        setting === 'runtime' ||
        setting === 'orchestrator'
        ? 'Changing this stops the current environment. Start again when ready.'
        : undefined;
}

function ProjectSetting({
    settings,
    projectDirectory,
    save,
    clone,
    onClose,
}: SettingEditorProps) {
    return (
        <ProjectPickerModal
            current={settings.resolved.project.value ?? projectDirectory}
            onSelect={(directory) => save('project', directory)}
            onClone={clone}
            onClose={onClose}
        />
    );
}

function OrchestratorSetting({ settings, save, onClose }: SettingEditorProps) {
    const { orchestrator, runtime } = settings.resolved;
    return (
        <ChoiceModal
            title="Orchestration"
            detail="Native manages Docker or Apple containers directly, with separate data. Stop the previous backend before switching."
            choices={
                runtime.value === 'apple'
                    ? [{ value: 'native', label: 'Native' }]
                    : [
                          { value: 'compose', label: 'Docker Compose' },
                          {
                              value: 'native',
                              label: 'Native (experimental)',
                          },
                          {
                              value: undefined,
                              label: 'Use default (compose)',
                          },
                      ]
            }
            current={orchestrator.file}
            notes={[envOverride(orchestrator), restartNotice('orchestrator')]}
            onChoose={(value) => save('orchestrator', value)}
            onClose={onClose}
        />
    );
}

function RuntimeSetting({ settings, save, onClose }: SettingEditorProps) {
    const { runtime } = settings.resolved;
    return (
        <ChoiceModal
            title="Container engine"
            detail={`Engine that runs the environment's containers. Overridden by ${settingEnvironment.runtime.join(' or ')}.`}
            choices={[
                ...supportedRuntimes.map((value) => ({
                    value,
                    label: value,
                })),
                { value: undefined, label: 'Use default (docker)' },
            ]}
            current={runtime.file}
            notes={[envOverride(runtime), restartNotice('runtime')]}
            onChoose={(value) => save('runtime', value)}
            onClose={onClose}
        />
    );
}

function AwsProfileSetting({
    settings,
    discovery,
    save,
    onClose,
}: SettingEditorProps) {
    const { awsProfile } = settings.resolved;
    const names =
        discovery.discovery?.profiles.map((profile) => profile.name) ?? [];
    return (
        <ChoiceModal
            title="AWS profile"
            detail={`Profile used for AWS login and the status bar. Overridden by ${settingEnvironment.awsProfile.join(' or ')}.`}
            choices={[
                ...names.map((value) => ({ value, label: value })),
                { value: undefined, label: 'Use default (default)' },
            ]}
            current={awsProfile.file}
            loading={
                discovery.discovery || discovery.error
                    ? undefined
                    : 'Detecting AWS profiles…'
            }
            notes={[
                discovery.error,
                ...(discovery.discovery?.warnings ?? []),
                envOverride(awsProfile),
            ]}
            onChoose={(value) => save('awsProfile', value)}
            onClose={onClose}
        />
    );
}

function EcrProfilesSetting({
    settings,
    discovery,
    save,
    onClose,
}: SettingEditorProps) {
    return (
        <ProfileChecklistModal
            discovery={discovery.discovery}
            loadError={discovery.error}
            configured={settings.resolved.ecrProfiles.file}
            notes={[envOverride(settings.resolved.ecrProfiles)]}
            onSave={(profiles) => save('ecrProfiles', profiles)}
            onClose={onClose}
        />
    );
}

function AutoApplySetting({ settings, save, onClose }: SettingEditorProps) {
    const { autoApply } = settings.resolved;
    return (
        <ChoiceModal
            title="Auto-apply edits"
            detail={`When on, saving a service edit applies it straight away while the environment is running. When off, edits wait until you choose Apply changes. Overridden by ${settingEnvironment.autoApply.join(' or ')}.`}
            choices={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
                { value: undefined, label: 'Use default (on)' },
            ]}
            current={
                autoApply.file === undefined
                    ? undefined
                    : autoApply.file
                      ? 'on'
                      : 'off'
            }
            notes={[envOverride(autoApply)]}
            onChoose={(value) =>
                save(
                    'autoApply',
                    value === undefined ? undefined : value === 'on',
                )
            }
            onClose={onClose}
        />
    );
}

function LoginActionSetting({ settings, save, onClose }: SettingEditorProps) {
    const { loginAction } = settings.resolved;
    return (
        <ChoiceModal
            title="Ctrl+L login"
            detail={`What Ctrl+L does. AWS + registry login also signs in to the ECR registries used to pull images. Overridden by ${settingEnvironment.loginAction.join(' or ')}.`}
            choices={[
                { value: 'registry', label: 'AWS + registry login' },
                { value: 'aws', label: 'AWS login only' },
                { value: 'ask', label: 'Ask every time' },
                {
                    value: undefined,
                    label: 'Use default (ask every time)',
                },
            ]}
            current={loginAction.file}
            notes={[envOverride(loginAction)]}
            onChoose={(value) =>
                save('loginAction', value as LoginChoice | undefined)
            }
            onClose={onClose}
        />
    );
}

function AutoLoginSetting({ settings, save, onClose }: SettingEditorProps) {
    const { autoLogin } = settings.resolved;
    return (
        <ChoiceModal
            title="Automatic login"
            detail={`An expired AWS session needs browser approval, so an automatic login briefly hands the terminal to the login command. It can recover a blocked start with the Environment window open. It runs the Ctrl+L login (AWS + registry unless you chose AWS only) and is tried once; a cancelled or failed login is not repeated. Overridden by ${settingEnvironment.autoLogin.join(' or ')}.`}
            choices={[
                { value: 'off', label: 'Off — press Ctrl+L to log in' },
                {
                    value: 'needed',
                    label: 'When needed — when starting or applying needs a login',
                },
                {
                    value: 'expired',
                    label: 'As soon as the AWS session expires',
                },
                {
                    value: undefined,
                    label: 'Use default (when needed)',
                },
            ]}
            current={autoLogin.file}
            notes={[envOverride(autoLogin)]}
            onChoose={(value) =>
                save('autoLogin', value as AutoLoginMode | undefined)
            }
            onClose={onClose}
        />
    );
}

export default function SettingEditor(props: SettingEditorProps) {
    switch (props.setting) {
        case 'project':
            return <ProjectSetting {...props} />;
        case 'orchestrator':
            return <OrchestratorSetting {...props} />;
        case 'runtime':
            return <RuntimeSetting {...props} />;
        case 'awsProfile':
            return <AwsProfileSetting {...props} />;
        case 'ecrProfiles':
            return <EcrProfilesSetting {...props} />;
        case 'autoApply':
            return <AutoApplySetting {...props} />;
        case 'loginAction':
            return <LoginActionSetting {...props} />;
        case 'autoLogin':
            return <AutoLoginSetting {...props} />;
    }
}
