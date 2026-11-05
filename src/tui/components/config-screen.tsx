import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import {
    settingKeys,
    settingLabels,
    type SettingKey,
} from '../../domain/settings.js';
import type { ProfileDiscovery } from '../../domain/aws-profiles.js';
import type { ProjectConfig } from '../../domain/project.js';
import type { SettingsSnapshot } from '../../domain/settings.js';
import { theme } from './theme.js';

export interface ConfigRow {
    key: SettingKey;
    label: string;
    value: string;
    source: string;
    problem?: string;
    note?: string;
    restart: boolean;
}

const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

function unexpectedSetting(key: unknown): never {
    throw new Error(`Unknown setting: ${key}`);
}

type DetailContext = {
    resolved: SettingsSnapshot['resolved'];
    projectConfig: ProjectConfig | undefined;
    discovery: ProfileDiscovery | undefined;
    restart: boolean;
};

type RowDetail = { value: string; problem?: string };

const detailBuilders: Record<
    SettingKey,
    (context: DetailContext) => RowDetail
> = {
    project: ({ resolved, projectConfig, restart }) => ({
        value:
            resolved.project.value ??
            projectConfig?.directory ??
            '(current directory)',
        problem:
            !restart && projectConfig && !projectConfig.valid
                ? resolved.project.value
                    ? projectConfig.message
                    : 'No project selected. Press Enter to choose one.'
                : undefined,
    }),
    awsProfile: ({ resolved }) => ({
        value: resolved.awsProfile.value,
    }),
    usageCache: ({ resolved }) => ({
        value: resolved.usageCache.value
            ? 'On — services unused for a run start lazy next time'
            : 'Off — every service keeps its configured start mode',
    }),
    loginAction: ({ resolved }) => ({
        value:
            resolved.loginAction.value === 'aws'
                ? 'AWS login'
                : resolved.loginAction.value === 'registry'
                  ? 'AWS + registry login'
                  : 'Ask every time',
    }),
    autoLogin: ({ resolved }) => ({
        value:
            resolved.autoLogin.value === 'needed'
                ? 'When needed — log in when starting or applying needs it'
                : resolved.autoLogin.value === 'expired'
                  ? 'As soon as the AWS session expires'
                  : 'Off — press Ctrl+L to log in',
    }),
    ecrProfiles: ({ resolved, discovery }) => ({
        value: resolved.ecrProfiles.value?.length
            ? resolved.ecrProfiles.value.join(', ')
            : discovery
              ? `automatic: ${(discovery.recommended.length ? discovery.recommended : [resolved.awsProfile.value]).join(', ')}`
              : 'automatic (detected from project registries)',
        problem: discovery?.unmatched.length
            ? `No local profile matches ${discovery.unmatched.join(', ')}.`
            : undefined,
    }),
};

export function configRows(
    settings: SettingsSnapshot,
    projectConfig: ProjectConfig | undefined,
    discovery: ProfileDiscovery | undefined,
): ConfigRow[] {
    const { resolved } = settings;
    return settingKeys
        .map((key): ConfigRow => {
            const setting = resolved[key];
            const restart = settings.restartPending.includes(key);
            const buildDetail = detailBuilders[key] ?? unexpectedSetting(key);
            const detail = buildDetail({
                resolved,
                projectConfig,
                discovery,
                restart,
            });
            return {
                key,
                label: settingLabels[key],
                value: detail.value,
                source:
                    setting.source === 'env'
                        ? `env ${setting.environment}`
                        : setting.source,
                problem: detail.problem,
                note:
                    setting.source === 'env' && setting.file !== undefined
                        ? `File value ${clean(String(setting.file))} is overridden by ${setting.environment}.`
                        : undefined,
                restart,
            };
        })
        .map((row) => ({
            ...row,
            value: clean(row.value),
            problem: row.problem && clean(row.problem),
        }));
}

function showRowDetail(row: ConfigRow, detailed: boolean) {
    return detailed && Boolean(row.problem || row.note);
}

function ConfigRowView({
    row,
    selected,
    detailed,
    labelWidth,
}: {
    row: ConfigRow;
    selected: boolean;
    detailed: boolean;
    labelWidth: number;
}) {
    return (
        <Box flexDirection="column" flexShrink={0}>
            <Box
                backgroundColor={
                    selected ? theme.selectionBackground : undefined
                }
            >
                <Box flexShrink={1} minWidth={0}>
                    <Text
                        wrap="truncate-middle"
                        color={
                            selected ? theme.selectionText : theme.foreground
                        }
                    >
                        <Text bold color={theme.accent}>
                            {selected ? '›' : ' '}
                        </Text>{' '}
                        <Text bold>{row.label.padEnd(labelWidth)}</Text>
                        {'  '}
                        {row.value}
                    </Text>
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                    <Text color={theme.muted}>[{row.source}]</Text>
                    {row.restart && (
                        <Text color={theme.development}>
                            {' '}
                            [reconfiguration pending]
                        </Text>
                    )}
                    {row.problem && !row.restart && (
                        <Text color={theme.development}> [Invalid]</Text>
                    )}
                </Box>
            </Box>
            {showRowDetail(row, detailed) && (
                <Text color={theme.muted} wrap="truncate-end">
                    {'   '}
                    {row.problem ?? row.note}
                </Text>
            )}
        </Box>
    );
}

function ConfigFooter({ settings }: { settings: SettingsSnapshot }) {
    return (
        <Box marginTop={1} flexDirection="column" flexShrink={0}>
            {settings.restartPending.length > 0 && (
                <Text color={theme.development} wrap="truncate-end">
                    Reconfiguration stops the current environment before
                    applying.
                </Text>
            )}
            {settings.warnings.map((warning) => (
                <Text key={warning} color={theme.development} wrap="wrap">
                    {clean(warning)}
                </Text>
            ))}
            {settings.errors.map((error) => (
                <Text key={error} color={theme.error} wrap="truncate-end">
                    {clean(error)}
                </Text>
            ))}
            {settings.path && (
                <Text color={theme.muted} wrap="truncate-middle">
                    Settings file: {settings.path}
                </Text>
            )}
        </Box>
    );
}

export default function ConfigScreen({
    rows,
    settings,
    active,
    height,
    onEdit,
}: {
    rows: ConfigRow[];
    settings: SettingsSnapshot;
    active: boolean;
    height: number;
    onEdit(key: SettingKey): void;
}) {
    const [selected, setSelected] = useState(0);
    useInput(
        (_input, key) => {
            if (key.upArrow)
                setSelected((value) => (value - 1 + rows.length) % rows.length);
            else if (key.downArrow)
                setSelected((value) => (value + 1) % rows.length);
            else if (key.return && rows[selected]) onEdit(rows[selected].key);
        },
        { isActive: active },
    );
    const labelWidth = Math.max(...rows.map((row) => row.label.length));
    // Compact terminals drop detail lines before the settings themselves.
    const detailed = height >= rows.length * 2 + 4;
    return (
        <Box flexDirection="column" overflow="hidden">
            {rows.map((row, index) => (
                <ConfigRowView
                    key={row.key}
                    row={row}
                    selected={index === selected}
                    detailed={detailed}
                    labelWidth={labelWidth}
                />
            ))}
            <ConfigFooter settings={settings} />
        </Box>
    );
}
