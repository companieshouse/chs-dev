import { Box, Text } from 'ink';
import type { ServiceGroup } from '../../domain/services.js';
import type { ServiceDetails } from '../../domain/services.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import { theme, statusColor } from './theme.js';

export default function ServiceList({
    groups,
    selected,
    height,
    details,
    statuses,
    defaultStatus,
}: {
    groups: ServiceGroup[];
    selected: number;
    height: number;
    details: Record<string, ServiceDetails>;
    statuses: Record<string, ServiceStatus>;
    defaultStatus: ServiceStatus;
}) {
    let serviceIndex = 0;
    const lines = groups.flatMap((group) => [
        { label: group.name, group: group.name, index: -1 },
        ...group.services.map((label) => ({
            label,
            group: group.name,
            index: serviceIndex++,
        })),
    ]);
    const selectedLine = lines.findIndex((line) => line.index === selected);
    const capacity = Math.max(1, height - 1);
    const start = Math.max(
        0,
        capacity === 1 ? selectedLine : selectedLine - capacity + 2,
    );
    const visible = lines.slice(start, start + capacity);
    // Keep the module name visible when the selected service scrolls past its heading.
    if (capacity > 1 && start > 0 && visible[0]?.index !== -1) {
        visible.unshift({
            label: visible[0]!.group,
            group: visible[0]!.group,
            index: -1,
        });
        visible.length = Math.min(visible.length, capacity);
    }

    return (
        <Box flexDirection="column" height={height} overflow="hidden">
            <ServiceRow
                name="SERVICE"
                enabled="ENABLED"
                status="STATUS"
                mode="MODE"
                heading
            />
            {visible.map((line, index) =>
                line.index === -1 ? (
                    <Text
                        key={index}
                        bold
                        color={theme.accent}
                        wrap="truncate-end"
                    >
                        {line.label}
                    </Text>
                ) : (
                    <ServiceRow
                        key={index}
                        name={`${line.index === selected ? '›' : ' '} ${line.label}`}
                        selected={line.index === selected}
                        enabled={details[line.label]?.enabled ?? 'Unknown'}
                        mode={details[line.label]?.mode ?? 'Unknown'}
                        status={statuses[line.label] ?? defaultStatus}
                    />
                ),
            )}
        </Box>
    );
}

function enabledColor(enabled: string) {
    if (enabled === 'Yes') return theme.enabled;
    if (enabled === 'No') return theme.disabled;
    return theme.muted;
}

function modeColor(mode: string) {
    if (mode === 'Development') return theme.development;
    if (mode === 'Mock') return theme.mocked;
    return theme.muted;
}

function serviceNameColor(heading: boolean, selected: boolean) {
    if (heading) return theme.columnHeading;
    return selected ? theme.selectionText : theme.foreground;
}

function ServiceRow({
    name,
    enabled,
    status,
    mode,
    selected = false,
    heading = false,
}: {
    name: string;
    enabled: string;
    status: string;
    mode: string;
    selected?: boolean;
    heading?: boolean;
}) {
    const nameContent = selected ? (
        <>
            <Text bold color={theme.accent}>
                ›
            </Text>
            {name.slice(1)}
        </>
    ) : (
        name
    );

    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Box flexGrow={1} flexBasis={0} minWidth={1} marginRight={1}>
                <Text
                    bold={Boolean(heading || selected)}
                    color={serviceNameColor(heading, selected)}
                    wrap="truncate-end"
                >
                    {nameContent}
                </Text>
            </Box>
            <Box width={9} flexShrink={0}>
                <Text
                    bold={heading || enabled === 'Yes'}
                    color={
                        heading ? theme.columnHeading : enabledColor(enabled)
                    }
                >
                    {enabled}
                </Text>
            </Box>
            <Box width={12} flexShrink={0}>
                <Text
                    bold={heading}
                    color={heading ? theme.columnHeading : statusColor(status)}
                >
                    {status}
                </Text>
            </Box>
            <Box width={11} flexShrink={0}>
                <Text
                    bold={heading}
                    color={heading ? theme.columnHeading : modeColor(mode)}
                >
                    {mode}
                </Text>
            </Box>
        </Box>
    );
}
