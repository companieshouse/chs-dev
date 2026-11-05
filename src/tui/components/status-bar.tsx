import { Box, Text } from 'ink';
import { type AwsState, type AwsStatus } from '../../domain/aws.js';
import { theme } from './theme.js';
import type { LiveState } from '../../domain/live.js';
import type { EnvironmentSummary } from '../../domain/environment.js';
import { environmentStatus } from '../models/environment.js';
import type { EnvironmentStatus } from '../models/environment.js';
import { toneColors } from './environment-panel.js';
import { useSpinner } from '../hooks/use-spinner.js';

const labels: Record<AwsState, string> = {
    checking: 'Checking…',
    active: 'Session active',
    expired: 'Session expired — log in again',
    'signed-out': 'Not authenticated',
    'missing-cli': 'CLI not installed',
    unconfigured: 'Check profile configuration',
    unavailable: 'Unable to verify',
};

const awsStateColors: Partial<Record<AwsState, string>> = {
    active: theme.enabled,
    expired: theme.error,
    'signed-out': theme.error,
    checking: theme.muted,
};

function EnvironmentSegment({
    status,
    busy,
    spinner,
    statusLabel,
}: {
    status: EnvironmentStatus;
    busy: boolean;
    spinner: string;
    statusLabel: string;
}) {
    const [hintKey, ...hintWords] = status.hint?.split(' ') ?? [];
    return (
        <Box flexShrink={0} marginRight={2}>
            <Text color={toneColors[status.tone]}>
                {busy ? spinner : status.icon} {statusLabel}
            </Text>
            {hintKey && (
                <Text color={theme.muted}>
                    {' · '}
                    <Text bold color={theme.accent}>
                        {hintKey}
                    </Text>
                    {hintWords.length ? ` ${hintWords.join(' ')}` : ''}
                </Text>
            )}
        </Box>
    );
}

function NoticeSegment({
    notice,
    hint,
}: {
    notice?: { text: string; tone: 'success' | 'muted' };
    hint?: string;
}) {
    if (notice) {
        return (
            <Box flexShrink={1} marginRight={2}>
                <Text
                    wrap="truncate-end"
                    color={
                        notice.tone === 'success' ? theme.enabled : theme.muted
                    }
                >
                    {notice.text.replace(/[\x00-\x1f\x7f-\x9f]/g, '')}
                </Text>
            </Box>
        );
    }
    if (hint === 'Ctrl+L') return null;
    return (
        <Box flexShrink={0} marginRight={2}>
            <Text color={theme.muted}>
                <Text bold color={theme.accent}>
                    Ctrl+L
                </Text>{' '}
                login
            </Text>
        </Box>
    );
}

export default function StatusBar({
    aws,
    profileName = 'default',
    runtimeName,
    live,
    environment,
    available = true,
    notice,
    restartRequired = false,
}: {
    aws: AwsStatus;
    profileName?: string;
    runtimeName: string;
    live: LiveState;
    environment?: EnvironmentSummary;
    available?: boolean;
    /** Transient message, e.g. the result of a Ctrl+L login. */
    notice?: { text: string; tone: 'success' | 'muted' };
    restartRequired?: boolean;
}) {
    const status = environmentStatus(live, environment, available);
    const busy = status.tone === 'busy';
    const spinner = useSpinner(busy);
    const statusLabel = busy
        ? status.label.replace(/(?:…|\.+)$/, '')
        : status.label;
    const profile = profileName.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    const color = awsStateColors[aws.state] ?? theme.development;
    return (
        <Box
            height={1}
            flexShrink={0}
            paddingX={1}
            backgroundColor={theme.selectionBackground}
        >
            {(environment || available) && (
                <EnvironmentSegment
                    status={status}
                    busy={busy}
                    spinner={spinner}
                    statusLabel={statusLabel}
                />
            )}
            <NoticeSegment notice={notice} hint={status.hint} />
            {restartRequired && (
                <Box flexShrink={0} marginRight={2}>
                    <Text color={theme.development}>Reconfigure in Config</Text>
                </Box>
            )}
            <Text wrap="truncate-end" color={theme.muted}>
                <Text bold color={theme.foreground}>
                    AWS
                </Text>{' '}
                <Text color={color}>{labels[aws.state]}</Text> · profile:{' '}
                {profile} · {runtimeName}
            </Text>
        </Box>
    );
}
