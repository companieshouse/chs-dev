import { statusColor, statusGlyph, theme } from './theme.js';
import SearchHeader from './search-header.js';
import { editText } from './text-input.js';
import { Box, Text, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';
import type { ServiceGroup } from '../../domain/services.js';
import type { ServiceDetails } from '../../domain/services.js';
import { enabledTree } from '../../domain/enabled-tree.js';
import { centeredStart } from '../models/modules.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import type { EnvironmentSummary } from '../../domain/environment.js';
import { plural } from '../models/formatting.js';
import { useSearch } from '../hooks/use-search.js';
import { footerBindingsForTab } from '../models/keymap.js';
import KeyboardHints from './keyboard-hints.js';
import TabScreen from './tab-screen.js';

function enabledServiceCount(rows: ReturnType<typeof enabledTree>) {
    return new Set(
        rows.filter((row) => row.kind === 'service').map((row) => row.name),
    ).size;
}

function filteredEnabledRows(
    rows: ReturnType<typeof enabledTree>,
    query: string,
) {
    if (!query) return rows;
    const normalized = query.toLocaleLowerCase();
    return rows.filter((row) =>
        row.name.toLocaleLowerCase().includes(normalized),
    );
}

function moveEnabledSelection(
    selected: number,
    services: number[],
    backward: boolean,
) {
    return Math.max(
        0,
        Math.min(services.length - 1, selected + (backward ? -1 : 1)),
    );
}

function editEnabledSearch(
    search: ReturnType<typeof useSearch>,
    input: string,
    key: import('ink').Key,
) {
    if (key.return) {
        search.finish();
        return;
    }
    const next = editText(search.query, input, key);
    if (next !== undefined) search.setQuery(next);
}

function useEnabledNavigation(
    rows: ReturnType<typeof enabledTree>,
    active: boolean,
    onOpen: (name: string) => void,
) {
    const search = useSearch();
    const { exit } = useApp();
    const [selected, setSelected] = useState(0);
    const visibleRows = useMemo(
        () => filteredEnabledRows(rows, search.query),
        [rows, search.query],
    );
    const services = visibleRows
        .map((row, index) => (row.kind === 'service' ? index : -1))
        .filter((index) => index >= 0);
    const selection = Math.min(selected, Math.max(0, services.length - 1));
    const selectedRow = services[selection] ?? 0;
    useInput(
        (input, key) => {
            if (key.escape) return search.clear();
            if (key.upArrow || key.downArrow) {
                search.finish();
                setSelected(
                    moveEnabledSelection(selection, services, key.upArrow),
                );
                return;
            }
            if (search.searching) {
                editEnabledSearch(search, input, key);
                return;
            }
            if (input === '/') return search.begin();
            if (input === 'q') return exit();
            if (key.return && visibleRows[selectedRow]?.kind === 'service')
                onOpen(visibleRows[selectedRow]!.name);
        },
        { isActive: active },
    );
    return {
        search,
        visibleRows,
        selectedRow,
    };
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
    const { search, visibleRows, selectedRow } = useEnabledNavigation(
        rows,
        active,
        onOpen,
    );
    const capacity = Math.max(1, height - 1);
    const start = centeredStart(selectedRow, capacity, visibleRows.length);
    const count = enabledServiceCount(rows);
    return (
        <TabScreen
            height={height}
            footer={
                <KeyboardHints
                    bindings={
                        search.searching
                            ? footerBindingsForTab('Enabled', 'search')
                            : footerBindingsForTab('Enabled')
                    }
                />
            }
        >
            <Text color={theme.muted} wrap="truncate-end">
                {plural(count, 'enabled service')}
                {environment ? ` · ${environment.label}` : ''}
            </Text>
            <SearchHeader
                searching={search.searching}
                query={search.query}
                hint="/ to filter enabled services"
            />
            {visibleRows.length === 0 && (
                <Text color={theme.foreground}>No services are enabled.</Text>
            )}
            {visibleRows.slice(start, start + capacity).map((row, index) =>
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
        </TabScreen>
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
