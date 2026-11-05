import { usePollingEffect } from '../hooks/use-polling-effect.js';
import { Box, Text, useApp, useInput } from 'ink';
import type { Key } from 'ink';
import { useCallback, useMemo, useState } from 'react';
import { useClient } from '../context.js';
const retention = '5 MiB active + 2 rotations; owner-only';
import { logWindow } from '../../domain/live-logs.js';
import {
    filterLogEntries,
    logFilters,
    parseLiveOutputLine,
    parseTuiLogLine,
    type LogCategory,
    type LogEntry,
    type LogFilter,
    type LogLevel,
} from '../../domain/log-view.js';
import type { LiveState } from '../../domain/live.js';
import { tabDirection } from '../models/navigation.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';
const empty = { lines: [] as string[], sequence: 0, failure: '', path: '' };

const categoryColors: Record<LogCategory, string> = {
    App: theme.muted,
    Config: theme.enabled,
    AWS: theme.development,
    Docker: theme.mocked,
    Env: theme.accent,
};
const levelColors: Record<LogLevel, string> = {
    debug: theme.muted,
    info: theme.foreground,
    warn: theme.development,
    error: theme.error,
};

interface LogsScreenProps {
    state: LiveState;
    active: boolean;
    height: number;
    initialFilter?: LogFilter;
    initialSource?: 'tui' | 'live';
}

function useDurableSnapshot(client: ReturnType<typeof useClient>) {
    const [durable, setDurable] = useState(empty);
    const refresh = useCallback(
        async (signal: AbortSignal) => {
            try {
                const value = await client.query('diagnostics', {}, signal);
                if (!signal.aborted)
                    setDurable({ ...value, lines: [...value.lines] });
            } catch {
                /* The next poll retries disconnected diagnostics. */
            }
        },
        [client],
    );
    usePollingEffect(true, refresh, 2000);
    return durable;
}

function LogSearch({
    searching,
    query,
}: {
    searching: boolean;
    query: string;
}) {
    if (!searching && !query) return null;
    return (
        <>
            {' · '}
            <Text color={searching ? theme.accent : theme.muted}>
                /{query}
                {searching ? '▏' : ''}
            </Text>
        </>
    );
}

function LogStatusLine({
    source,
    filter,
    verbose,
    raw,
    shown,
    hidden,
    paused,
    searching,
    query,
}: {
    source: 'tui' | 'live';
    filter: LogFilter;
    verbose: boolean;
    raw: boolean;
    shown: number;
    hidden: number;
    paused: boolean;
    searching: boolean;
    query: string;
}) {
    return (
        <Text color={theme.muted} wrap="truncate-end">
            <Text bold color={theme.foreground}>
                {source === 'tui' ? 'Daemon events' : 'Environment output'}
            </Text>
            {' · filter '}
            <Text bold color={theme.accent}>
                {filter}
            </Text>
            {verbose || raw ? ' · all detail' : ''}
            {raw ? ' · raw' : ''}
            {` · ${shown} shown`}
            {hidden ? ` (${hidden} hidden)` : ''}
            {' · '}
            <Text color={paused ? theme.development : theme.muted}>
                {paused ? 'Scroll paused' : 'Following'}
            </Text>
            <LogSearch searching={searching} query={query} />
        </Text>
    );
}

function LogSourceLine({
    source,
    path,
}: {
    source: 'tui' | 'live';
    path: string;
}) {
    return (
        <Text color={theme.muted} wrap="truncate-middle">
            {source === 'tui'
                ? `${path || 'File logging not initialized'} · ${retention}`
                : 'In memory only · preparation output also in runtime.log'}
        </Text>
    );
}

function LogLines({
    visible,
    raw,
    hasEntries,
}: {
    visible: readonly LogEntry[];
    raw: boolean;
    hasEntries: boolean;
}) {
    if (visible.length === 0)
        return (
            <Text color={theme.muted}>
                {hasEntries
                    ? 'No matching lines. Press c to change the filter or v to show detail.'
                    : 'No events for this source in this session.'}
            </Text>
        );
    return (
        <>
            {visible.map((entry, index) =>
                raw ? (
                    <Text
                        key={index}
                        wrap="truncate-end"
                        color={theme.foreground}
                    >
                        {entry.raw}
                    </Text>
                ) : (
                    <Text key={index} wrap="truncate-end">
                        <Text color={theme.muted}>{entry.time.padEnd(8)}</Text>{' '}
                        <Text color={categoryColors[entry.category]}>
                            {entry.category.padEnd(6)}
                        </Text>{' '}
                        <Text color={levelColors[entry.level]}>
                            {entry.text}
                        </Text>
                    </Text>
                ),
            )}
        </>
    );
}

function useLogOptions(
    initialFilter: LogFilter,
    initialSource: 'tui' | 'live',
) {
    const [source, setSource] = useState<'tui' | 'live'>(initialSource);
    const [filterIndex, setFilterIndex] = useState(() =>
        Math.max(0, logFilters.indexOf(initialFilter)),
    );
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [verbose, setVerbose] = useState(false);
    const [raw, setRaw] = useState(false);
    const handleSearchInput = (input: string, key: Key) => {
        if (key.return || key.escape) {
            setSearching(false);
            return;
        }
        setQuery((current) => editText(current, input, key) ?? current);
    };
    const commands: Record<string, () => void> = {
        '/': () => setSearching(true),
        s: () => setSource((current) => (current === 'tui' ? 'live' : 'tui')),
        c: () => setFilterIndex((current) => (current + 1) % logFilters.length),
        C: () =>
            setFilterIndex(
                (current) =>
                    (current + logFilters.length - 1) % logFilters.length,
            ),
        v: () => setVerbose((current) => !current),
        r: () => setRaw((current) => !current),
    };
    return {
        source,
        filter: logFilters[filterIndex]!,
        query,
        searching,
        verbose,
        raw,
        editQuery: handleSearchInput,
        leaveSearch: () => setSearching(false),
        clearSearch: () => {
            if (!query) return false;
            setQuery('');
            return true;
        },
        command: (input: string) => {
            const run = commands[input];
            if (!run) return false;
            run();
            // Detail toggles preserve the paused position.
            return !['/', 'v', 'r'].includes(input);
        },
    };
}

function useLogEntries(
    lines: readonly string[],
    source: 'tui' | 'live',
    filter: LogFilter,
    query: string,
    detail: boolean,
) {
    const entries = useMemo(
        () =>
            lines.map(source === 'tui' ? parseTuiLogLine : parseLiveOutputLine),
        [lines, source],
    );
    const shown = useMemo(
        () => filterLogEntries(entries, filter, query, detail),
        [entries, filter, query, detail],
    );
    return { entries, shown };
}

function logViewport(
    count: number,
    shown: number,
    height: number,
    failure: string,
    pause: { offset: number; length: number } | undefined,
) {
    const hidden = count - shown;
    const headerLines = 2 + (failure ? 1 : 0);
    const visibleHeight = Math.max(1, height - headerLines);
    const maxOffset = Math.max(0, shown - visibleHeight);
    const offset = pause
        ? Math.min(maxOffset, Math.max(0, pause.offset + shown - pause.length))
        : 0;
    return { hidden, visibleHeight, maxOffset, offset };
}

function logDisplayOptions({
    source,
    filter,
    verbose,
    raw,
}: ReturnType<typeof useLogOptions>) {
    return { source, filter, verbose, raw };
}

function useLogBrowser({
    state,
    active,
    height,
    initialFilter = 'All',
    initialSource = 'tui',
}: LogsScreenProps) {
    const { exit } = useApp();
    const client = useClient();
    const durable = useDurableSnapshot(client);
    const options = useLogOptions(initialFilter, initialSource);
    const { source, filter, query, searching, verbose, raw } = options;
    // Paused scroll position: offset from the tail when paused, plus the
    // filtered length at that moment so new lines do not move the view.
    const [pause, setPause] = useState<{ offset: number; length: number }>();
    const lines = source === 'tui' ? durable.lines : state.logs;
    const { entries, shown } = useLogEntries(
        lines,
        source,
        filter,
        query,
        verbose || raw,
    );
    const { hidden, visibleHeight, maxOffset, offset } = logViewport(
        entries.length,
        shown.length,
        height,
        durable.failure,
        pause,
    );
    const scrollTo = (next: number) =>
        setPause(
            next <= 0
                ? undefined
                : { offset: Math.min(maxOffset, next), length: shown.length },
        );
    const resetView = () => setPause(undefined);
    const handleScroll = (key: Key) => {
        if (key.upArrow || key.pageUp)
            scrollTo(offset + (key.pageUp ? visibleHeight : 1));
        else if (key.downArrow || key.pageDown)
            scrollTo(offset - (key.pageDown ? visibleHeight : 1));
    };
    useInput(
        (input, key) => {
            if (tabDirection(input, key) !== null) {
                options.leaveSearch();
                return;
            }
            if (searching) {
                options.editQuery(input, key);
                resetView();
                return;
            }
            if (key.escape && options.clearSearch()) {
                resetView();
                return;
            }
            if (input === 'q' || key.escape) exit();
            else if (input === 'f' || key.end) resetView();
            else if (options.command(input)) resetView();
            else handleScroll(key);
        },
        { isActive: active },
    );
    const visible = logWindow(shown, visibleHeight, offset);
    return {
        ...logDisplayOptions(options),
        shown,
        hidden,
        searching,
        query,
        pause,
        offset,
        visibleHeight,
        visible,
        durable,
        hasEntries: entries.length > 0,
    };
}
export default function LogsScreen(props: LogsScreenProps) {
    const {
        source,
        filter,
        verbose,
        raw,
        shown,
        hidden,
        searching,
        query,
        pause,
        offset,
        visibleHeight,
        visible,
        durable,
        hasEntries,
    } = useLogBrowser(props);
    const { height } = props;
    return (
        <Box flexDirection="column">
            <LogStatusLine
                source={source}
                filter={filter}
                verbose={verbose}
                raw={raw}
                shown={shown.length}
                hidden={hidden}
                paused={!!pause}
                searching={searching}
                query={query}
            />
            <LogSourceLine source={source} path={durable.path} />
            {durable.failure && (
                <Text color={theme.error}>{durable.failure}</Text>
            )}
            <LogLines visible={visible} raw={raw} hasEntries={hasEntries} />
        </Box>
    );
}
