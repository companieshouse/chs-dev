import SearchHeader from './search-header.js';
import { editText } from './text-input.js';
import { centeredStart } from '../models/modules.js';
import { Box, Text, useApp, useInput } from 'ink';
import type { Key } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    ContainerManager,
    ContainerSummary,
} from '../../domain/containers.js';
import {
    filterContainers,
    serviceContainers,
} from '../../domain/containers.js';
import { useContainers } from '../hooks/use-containers.js';
import { useSpinner } from '../hooks/use-spinner.js';
import { tabDirection } from '../models/navigation.js';
import { useSearch } from '../hooks/use-search.js';
import { theme, statusColor } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import { footerBindingsForTab } from '../models/keymap.js';
import { plural } from '../models/formatting.js';
import TabScreen from './tab-screen.js';

export interface ContainerRequest {
    service: string;
    sequence: number;
}

function useContainerRequest({
    request,
    active,
    loading,
    error,
    containers,
    onOpen,
    showService,
}: {
    request: ContainerRequest | undefined;
    active: boolean;
    loading: boolean;
    error: string;
    containers: ContainerSummary[];
    onOpen: (id: string) => void;
    showService: (service: string) => void;
}) {
    const handled = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!request) return;
        showService(request.service);
    }, [request, showService]);
    useEffect(() => {
        if (
            !active ||
            loading ||
            error ||
            !request ||
            handled.current === request.sequence
        )
            return;
        handled.current = request.sequence;
        const matches = serviceContainers(containers, request.service);
        const primary = matches.filter((c) => c.service === request.service);
        if (primary.length === 1) onOpen(primary[0].id);
        else if (matches.length === 1) onOpen(matches[0].id);
    }, [active, loading, error, request, containers, onOpen]);
}

const viewport = (
    filtered: ContainerSummary[],
    selected: string | undefined,
    height: number,
    error: string,
) => {
    const index = Math.max(
        0,
        filtered.findIndex((c) => c.id === selected),
    );
    const capacity = Math.max(1, height - 6 - (error ? 1 : 0));
    const start = centeredStart(index, capacity, filtered.length);
    return { index, capacity, start };
};

function ContainersHeader({
    all,
    service,
    count,
    loading,
    spinner,
    searching,
    query,
    manager,
    error,
}: {
    all: boolean;
    service: string | undefined;
    count: number;
    loading: boolean;
    spinner: string;
    searching: boolean;
    query: string;
    manager: ContainerManager | undefined;
    error: string;
}) {
    return (
        <>
            <Text color={theme.accent} bold wrap="truncate-end">
                {all ? 'All containers on this engine' : 'This checkout'}
                {service ? ` · ${service}` : ''} · {plural(count, 'container')}{' '}
                {loading ? spinner : ''}
            </Text>
            <SearchHeader
                searching={searching}
                query={query}
                hint="/ to filter by name, image, service or status"
            />
            {!manager ? (
                <Text color={theme.muted}>
                    Container management is unavailable. Select a project and
                    supported runtime in Config.
                </Text>
            ) : error ? (
                <Text color={theme.error} wrap="truncate-end">
                    {error} · r retry
                </Text>
            ) : null}
        </>
    );
}

function ColumnHeadings() {
    return (
        <Box flexShrink={0}>
            <Box width="38%">
                <Text color={theme.columnHeading}>CONTAINER</Text>
            </Box>
            <Box width={13}>
                <Text color={theme.columnHeading}>STATUS</Text>
            </Box>
            <Box flexGrow={1}>
                <Text color={theme.columnHeading}>IMAGE</Text>
            </Box>
        </Box>
    );
}

function ContainerRow({
    container,
    selected,
}: {
    container: ContainerSummary;
    selected: boolean;
}) {
    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Box width="38%">
                <Text
                    wrap="truncate-end"
                    color={selected ? theme.selectionText : theme.foreground}
                >
                    {selected ? '›' : ' '} {container.name}
                </Text>
            </Box>
            <Box width={13}>
                <Text wrap="truncate-end" color={statusColor(container.status)}>
                    {container.status}
                </Text>
            </Box>
            <Box flexGrow={1} flexBasis={0}>
                <Text wrap="truncate-end" color={theme.muted}>
                    {container.image}
                </Text>
            </Box>
        </Box>
    );
}

function EmptyNotice({
    manager,
    loading,
    error,
    count,
    service,
    all,
}: {
    manager: ContainerManager | undefined;
    loading: boolean;
    error: string;
    count: number;
    service: string | undefined;
    all: boolean;
}) {
    if (!manager || loading || error || count) return null;
    return (
        <Text color={theme.muted}>
            {service
                ? `No container exists for ${service}. Start or apply the environment to create it.`
                : all
                  ? 'No matching containers.'
                  : 'No matching containers for this checkout. Press a to see all containers.'}
        </Text>
    );
}

interface ContainersScreenProps {
    manager?: ContainerManager;
    active: boolean;
    height: number;
    request?: ContainerRequest;
    onOpen(id: string): void;
}

function useContainerFilters(exit: () => void) {
    const [all, setAll] = useState(false);
    const searchState = useSearch();
    const { query, searching, setQuery, setSearching, clear } = searchState;
    const [service, setService] = useState<string>();
    const [selected, setSelected] = useState<string>();
    const showService = useCallback(
        (name: string) => {
            setService(name);
            setAll(false);
            setQuery('');
            setSearching(false);
            setSelected(undefined);
        },
        [setQuery, setSearching],
    );
    const handleEscape = () => {
        clear();
        setService(undefined);
    };
    const editQuery = (input: string, key: Key) => {
        if (key.return) setSearching(false);
        else setQuery((current) => editText(current, input, key) ?? current);
    };
    return {
        all,
        query,
        searching,
        service,
        selected,
        showService,
        select: (id: string | undefined) => setSelected(id),
        escape: handleEscape,
        editQuery,
        leaveSearch: () => setSearching(false),
        search: () => setSearching(true),
        toggleScope: () => {
            setAll((value) => !value);
            setService(undefined);
        },
    };
}

function useContainerBrowser({
    manager,
    active,
    height,
    request,
    onOpen,
}: ContainersScreenProps) {
    const { exit } = useApp();
    const { containers, loading, error, refresh } = useContainers(
        manager,
        active,
    );
    const filters = useContainerFilters(exit);
    const { all, query, searching, service, selected, showService } = filters;
    const spinner = useSpinner(active && loading);
    useContainerRequest({
        request,
        active,
        loading,
        error,
        containers,
        onOpen,
        showService,
    });
    const filtered = filterContainers(containers, { all, query, service });
    const { index, capacity, start } = viewport(
        filtered,
        selected,
        height,
        error,
    );
    const handleMove = (key: Key) => {
        if (!key.upArrow && !key.downArrow && !key.pageUp && !key.pageDown)
            return false;
        const delta = key.upArrow
            ? -1
            : key.downArrow
              ? 1
              : key.pageUp
                ? -capacity
                : capacity;
        filters.select(
            filtered[Math.max(0, Math.min(filtered.length - 1, index + delta))]
                ?.id,
        );
        return true;
    };
    const handleShortcut = (input: string, key: Key) => {
        if (input === '/') {
            filters.search();
        } else if (input === 'a') {
            filters.toggleScope();
        } else if (input === 'r') refresh();
        else if (key.return && filtered[index] && !error)
            onOpen(filtered[index].id);
        else if (input === 'q') exit();
    };
    useContainerInput(active, searching, {
        leaveSearch: filters.leaveSearch,
        escape: filters.escape,
        move: handleMove,
        search: filters.editQuery,
        command: handleShortcut,
    });
    return containerPresentation(
        { all, service, loading, spinner, searching, query, manager, error },
        filtered,
        { index, capacity, start },
    );
}
function containerPresentation(
    header: Omit<Parameters<typeof ContainersHeader>[0], 'count'>,
    filtered: ContainerSummary[],
    window: ReturnType<typeof viewport>,
) {
    const { manager, loading, error, service, all } = header;
    const count = filtered.length;
    return {
        header: { ...header, count },
        list: { filtered, ...window },
        empty: { manager, loading, error, count, service, all },
    };
}

function useContainerInput(
    active: boolean,
    searching: boolean,
    actions: {
        leaveSearch(): void;
        escape(): void;
        move(key: Key): boolean;
        search(input: string, key: Key): void;
        command(input: string, key: Key): void;
    },
) {
    useInput(
        (input, key) => {
            if (tabDirection(input, key) !== null) return actions.leaveSearch();
            if (key.escape) return actions.escape();
            if (actions.move(key)) return;
            if (searching) return actions.search(input, key);
            actions.command(input, key);
        },
        { isActive: active },
    );
}
export default function ContainersScreen(props: ContainersScreenProps) {
    const { header, list, empty } = useContainerBrowser(props);
    const { filtered, index, capacity, start } = list;
    const searching = header.searching;
    const height = props.height;
    return (
        <TabScreen
            height={height}
            footer={
                <KeyboardHints
                    bindings={
                        searching
                            ? footerBindingsForTab('Containers', 'search')
                            : footerBindingsForTab('Containers')
                    }
                />
            }
        >
            <ContainersHeader {...header} />
            <ColumnHeadings />
            {filtered.slice(start, start + capacity).map((c, row) => (
                <ContainerRow
                    key={c.id}
                    container={c}
                    selected={start + row === index}
                />
            ))}
            <EmptyNotice {...empty} />
        </TabScreen>
    );
}
