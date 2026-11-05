import type { AutoLoginMode } from '../../domain/auto-login.js';
import {
    settingEnvironment,
    type LoginChoice,
    type SettingKey,
    type SettingValues,
} from '../../domain/settings.js';
import type { OperationResult } from '../../domain/runtime-strategy.js';
import type { ProfileDiscovery } from '../../domain/aws-profiles.js';
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

function UsageCacheSetting({ settings, save, onClose }: SettingEditorProps) {
    const { usageCache } = settings.resolved;
    return (
        <ChoiceModal
            title="Usage cache"
            detail={`Usage is always recorded. When on, services that saw no traffic in the last run start lazy next time. When off, every service keeps its configured start mode. Overridden by ${settingEnvironment.usageCache.join(' or ')}.`}
            choices={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
                { value: undefined, label: 'Use default (off)' },
            ]}
            current={
                usageCache.file === undefined
                    ? undefined
                    : usageCache.file
                      ? 'on'
                      : 'off'
            }
            notes={[envOverride(usageCache)]}
            onChoose={(value) =>
                save(
                    'usageCache',
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
        case 'awsProfile':
            return <AwsProfileSetting {...props} />;
        case 'ecrProfiles':
            return <EcrProfilesSetting {...props} />;
        case 'usageCache':
            return <UsageCacheSetting {...props} />;
        case 'loginAction':
            return <LoginActionSetting {...props} />;
        case 'autoLogin':
            return <AutoLoginSetting {...props} />;
    }
}
