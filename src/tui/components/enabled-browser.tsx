import { statusColor, statusGlyph, theme } from './theme.js';
import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import type { ServiceGroup } from '../../domain/services.js';
import type { ServiceDetails } from '../../domain/services.js';
import { enabledTree } from '../../domain/enabled-tree.js';
import { centeredStart } from '../models/modules.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import type { EnvironmentSummary } from '../../domain/environment.js';

function enabledServiceCount(rows: ReturnType<typeof enabledTree>) {
    return new Set(
        rows.filter((row) => row.kind === 'service').map((row) => row.name),
    ).size;
}

export default function EnabledBrowser({
    groups,
    details,
    statuses,
    defaultStatus,
    environment,
    active,
    height,
    onOpen,
}: {
    groups: ServiceGroup[];
    details: Record<string, ServiceDetails>;
    statuses: Record<string, ServiceStatus>;
    defaultStatus: ServiceStatus;
    environment?: EnvironmentSummary;
    active: boolean;
    height: number;
    onOpen: (name: string) => void;
}) {
    const rows = useMemo(() => enabledTree(groups, details), [groups, details]);
    const [selected, setSelected] = useState(0);
    const services = rows
        .map((row, index) => (row.kind === 'service' ? index : -1))
        .filter((index) => index >= 0);
    const selection = Math.min(selected, Math.max(0, services.length - 1));
    const selectedRow = services[selection] ?? 0;
    const capacity = Math.max(1, height - 1);
    const start = centeredStart(selectedRow, capacity, rows.length);
    const count = enabledServiceCount(rows);
    useInput(
        (_input, key) => {
            if (key.upArrow || key.downArrow)
                setSelected(
                    Math.max(
                        0,
                        Math.min(
                            services.length - 1,
                            selection + (key.upArrow ? -1 : 1),
                        ),
                    ),
                );
            if (key.return && rows[selectedRow]?.kind === 'service')
                onOpen(rows[selectedRow]!.name);
        },
        { isActive: active },
    );
    return (
        <Box flexDirection="column" height={height} overflow="hidden">
            <Text color={theme.muted} wrap="truncate-end">
                {count} enabled services
                {environment ? ` · ${environment.label}` : ''}
            </Text>
            {rows.length === 0 && (
                <Text color={theme.foreground}>No services are enabled.</Text>
            )}
            {rows.slice(start, start + capacity).map((row, index) =>
                row.kind === 'module' ? (
                    <Text
                        key={start + index}
                        bold
                        color={theme.accent}
                        wrap="truncate-end"
                    >
                        {row.name}
                    </Text>
                ) : (
                    <EnabledServiceRow
                        key={start + index}
                        selected={start + index === selectedRow}
                        prefix={row.prefix}
                        name={row.name}
                        reference={row.reference}
                        status={statuses[row.name] ?? defaultStatus}
                    />
                ),
            )}
        </Box>
    );
}

function EnabledServiceRow({
    selected,
    prefix,
    name,
    reference,
    status,
}: {
    selected: boolean;
    prefix: string;
    name: string;
    reference?: string;
    status: ServiceStatus;
}) {
    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Box flexGrow={1} flexBasis={0} minWidth={1} marginRight={1}>
                <Text wrap="truncate-end">
                    <Text bold color={theme.accent}>
                        {selected ? '›' : ' '}
                    </Text>{' '}
                    <Text color={theme.border}>{prefix}</Text>
                    <Text color={statusColor(status)}>
                        {statusGlyph(status)}
                    </Text>{' '}
                    <Text
                        bold={selected}
                        color={
                            selected ? theme.selectionText : theme.foreground
                        }
                    >
                        {name}
                    </Text>
                    {reference && (
                        <Text color={theme.muted}> ({reference})</Text>
                    )}
                </Text>
            </Box>
            <Box width={12} flexShrink={0}>
                <Text color={statusColor(status)}>{status}</Text>
            </Box>
        </Box>
    );
}
