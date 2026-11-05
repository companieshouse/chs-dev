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
    const hasScenarios = Object.values(details).some(
        (detail) => detail.mockScenario,
    );
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
                scenario={hasScenarios ? 'SCENARIO' : undefined}
                heading
            />
            {visible.map((line, index) => (
                <ServiceListItem
                    key={index}
                    line={line}
                    selected={selected}
                    details={details[line.label]}
                    status={statuses[line.label] ?? defaultStatus}
                    hasScenarios={hasScenarios}
                />
            ))}
        </Box>
    );
}

function ServiceListItem({
    line,
    selected,
    details,
    status,
    hasScenarios,
}: {
    line: { label: string; index: number };
    selected: number;
    details?: ServiceDetails;
    status: ServiceStatus;
    hasScenarios: boolean;
}) {
    if (line.index === -1)
        return (
            <Text bold color={theme.accent} wrap="truncate-end">
                {line.label}
            </Text>
        );
    return (
        <ServiceRow
            name={`${line.index === selected ? '›' : ' '} ${line.label}`}
            selected={line.index === selected}
            enabled={details?.enabled ?? 'Unknown'}
            mode={details?.mode ?? 'Unknown'}
            scenario={hasScenarios ? (details?.mockScenario ?? '—') : undefined}
            status={status}
        />
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
    scenario,
    selected = false,
    heading = false,
}: {
    name: string;
    enabled: string;
    status: string;
    mode: string;
    scenario?: string;
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
            <ScenarioCell scenario={scenario} heading={heading} />
        </Box>
    );
}

function ScenarioCell({
    scenario,
    heading,
}: {
    scenario?: string;
    heading: boolean;
}) {
    if (scenario === undefined) return null;
    return (
        <Box width={14} flexShrink={0}>
            <Text
                color={heading ? theme.columnHeading : theme.mocked}
                wrap="truncate-end"
            >
                {scenario}
            </Text>
        </Box>
    );
}
