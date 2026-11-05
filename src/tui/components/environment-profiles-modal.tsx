import { useEnvironmentProfiles } from '../hooks/use-environment-profiles.js';
import {
    ProfileInput,
    ProfileMenu,
    ProfileReview,
} from './profile-controls.js';

export default function EnvironmentProfilesModal({
    onClose,
}: {
    onClose(): void;
}) {
    const profiles = useEnvironmentProfiles();
    const { screen } = profiles;
    const status = {
        busy: profiles.busy,
        error: profiles.error,
        notice: profiles.notice,
    };
    if (screen.kind === 'menu')
        return (
            <ProfileMenu
                status={status}
                onSelect={profiles.open}
                onClose={onClose}
            />
        );
    if (screen.kind === 'input')
        return (
            <ProfileInput
                key={screen.action}
                title={`${screen.action === 'export' ? 'Export' : 'Import'} environment file`}
                initial={`${profiles.directory}/environments/environment.yaml`}
                status={status}
                onSubmit={profiles.submit}
                onClose={profiles.menu}
            />
        );
    const lines = [
        ...screen.preview.warnings.map((warning) => `Warning: ${warning}`),
        ...screen.preview.changes.map(
            (change) =>
                `${change.service} · ${change.field}: ${change.before} → ${change.after}`,
        ),
    ];
    return (
        <ProfileReview
            lines={lines.length ? lines : ['No configuration changes.']}
            status={status}
            onSave={profiles.save}
            onClose={profiles.menu}
        />
    );
}
