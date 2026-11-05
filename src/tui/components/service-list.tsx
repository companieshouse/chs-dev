import { Box, Text } from 'ink';
import type { ServiceGroup, ServiceDetails } from '../../domain/services.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import { middleEllipsis } from '../models/formatting.js';
import { theme, statusColor } from './theme.js';

export function serviceVersion(detail?: ServiceDetails): string {
    return detail?.versionLabel ?? detail?.image ?? '—';
}

export default function ServiceList({
    groups,
    selected,
    height,
    width,
    details,
    statuses,
    defaultStatus,
}: {
    groups: ServiceGroup[];
    selected: number;
    height: number;
    width: number;
    details: Record<string, ServiceDetails>;
    statuses: Record<string, ServiceStatus>;
    defaultStatus: ServiceStatus;
}) {
    const names = groups.flatMap((group) => group.services);
    const capacity = Math.max(1, height - 2);
    const start = Math.max(
        0,
        Math.min(selected - Math.floor(capacity / 2), names.length - capacity),
    );
    const visible = names.slice(start, start + capacity);
    const nameWidth = Math.max(1, width - 35);
    return (
        <Box flexDirection="column" height={height} overflow="hidden">
            <Row
                name="SERVICE"
                saved="SAVED"
                runtime="RUNTIME"
                version="SAVED VER"
                nameWidth={nameWidth}
                heading
            />
            {visible.map((name, offset) => {
                const detail = details[name];
                const mode = {
                    Service: 'Service',
                    Development: 'Dev',
                    Mock: 'Mock',
                    Unknown: '?',
                }[detail?.mode ?? 'Unknown'];
                const enabled =
                    detail?.enabled === 'Unknown'
                        ? '?'
                        : (detail?.enabled ?? '?');
                return (
                    <Row
                        key={name}
                        name={`${start + offset === selected ? '›' : ' '} ${name}`}
                        saved={`${enabled} ${mode}`}
                        runtime={statuses[name] ?? defaultStatus}
                        version={serviceVersion(detail)}
                        nameWidth={nameWidth}
                        selected={start + offset === selected}
                    />
                );
            })}
            <Box flexGrow={1} />
            <Text color={theme.muted}>
                {start + 1}–{Math.min(start + capacity, names.length)} of{' '}
                {names.length} · PgUp/PgDn page
            </Text>
        </Box>
    );
}

function Row({
    name,
    saved,
    runtime,
    version,
    nameWidth,
    selected = false,
    heading = false,
}: {
    name: string;
    saved: string;
    runtime: string;
    version: string;
    nameWidth: number;
    selected?: boolean;
    heading?: boolean;
}) {
    return (
        <Text
            wrap="truncate-end"
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Text
                bold={selected || heading}
                color={selected ? theme.accent : theme.foreground}
            >
                {middleEllipsis(name, nameWidth).padEnd(nameWidth)}{' '}
            </Text>
            <Text color={theme.muted}>{saved.padEnd(12)} </Text>
            <Text color={heading ? theme.muted : statusColor(runtime)}>
                {runtime.padEnd(11)}{' '}
            </Text>
            <Text color={theme.muted}>{middleEllipsis(version, 9)}</Text>
        </Text>
    );
}
