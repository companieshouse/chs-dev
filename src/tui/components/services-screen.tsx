import SearchHeader from './search-header.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import { Box, Text, useApp, useInput } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';
import type { ServiceGroup, ServiceDetails } from '../../domain/services.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import {
    filterServices,
    type ServiceEnabledFilter,
} from '../../domain/service-filter.js';
import ServiceList from './service-list.js';
import { tabDirection } from '../models/navigation.js';

interface Props {
    active: boolean;
    height: number;
    groups: ServiceGroup[];
    details: Record<string, ServiceDetails>;
    statuses: Record<string, ServiceStatus>;
    defaultStatus: ServiceStatus;
    loading: boolean;
    error: string;
    stateError: string;
    runtimeName: string;
    runtimeState: 'loading' | 'ready' | 'error';
    onOpen: (name: string) => void;
    onContainer?: (name: string) => void;
}

const enabledFilters: ServiceEnabledFilter[] = ['All', 'Enabled', 'Disabled'];

function runServiceCommand(
    input: string,
    key: Key,
    name: string | undefined,
    screen: Pick<Props, 'loading' | 'error' | 'onOpen' | 'onContainer'>,
) {
    if (screen.loading || screen.error || !name) return;
    if (key.return) screen.onOpen(name);
    if (input === 'c') screen.onContainer?.(name);
}

function useServiceBrowser(props: Props) {
    const { exit } = useApp();
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState(0);
    const [enabled, setEnabled] = useState<ServiceEnabledFilter>('All');
    const filtered = filterServices(props.groups, query, {
        enabled,
        details: props.details,
    });
    const names = filtered.flatMap((group) => group.services);
    const selection = Math.min(selected, Math.max(0, names.length - 1));
    const filter = (value: string) => {
        setQuery(value);
        setSelected(0);
    };
    const escape = () => {
        if (searching) setSearching(false);
        else if (query || enabled !== 'All') {
            filter('');
            setEnabled('All');
        } else exit();
    };
    const cycleEnabled = () => {
        setEnabled(
            (current) =>
                enabledFilters[
                    (enabledFilters.indexOf(current) + 1) %
                        enabledFilters.length
                ]!,
        );
        setSelected(0);
    };
    const shortcuts = new Map<string, () => void>([
        ['e', cycleEnabled],
        ['q', exit],
    ]);
    const search = (input: string, key: Key) => {
        if (key.return) return setSearching(false);
        const next = editText(query, input, key);
        if (next !== undefined) filter(next);
    };
    useInput(
        (input, key) => {
            if (tabDirection(input, key) !== null) {
                setSearching(false);
                return;
            }
            if (key.upArrow || key.downArrow) {
                setSearching(false);
                setSelected((current) => {
                    const next =
                        Math.min(current, names.length - 1) +
                        (key.upArrow ? -1 : 1);
                    return Math.max(0, Math.min(names.length - 1, next));
                });
                return;
            }
            if (key.escape) return escape();
            if (searching) return search(input, key);
            if (input === '/') {
                setSearching(true);
                filter('');
                return;
            }
            const shortcut = shortcuts.get(input);
            if (shortcut && !key.ctrl && !key.meta) return shortcut();
            runServiceCommand(input, key, names[selection], props);
        },
        { isActive: props.active },
    );
    return {
        query,
        searching,
        enabled,
        selected: selection,
        filtered,
        count: names.length,
    };
}

function ServiceBrowserContent({
    screen,
    browser,
}: {
    screen: Props;
    browser: ReturnType<typeof useServiceBrowser>;
}) {
    if (screen.loading)
        return <Text color={theme.foreground}>Loading services…</Text>;
    if (screen.error)
        return <Text color={theme.development}>{screen.error}</Text>;

    const { query, searching, enabled, selected, filtered, count } = browser;
    const warning =
        screen.stateError ||
        (screen.runtimeState === 'error'
            ? `${screen.runtimeName} status unavailable; retrying…`
            : '');
    const listHeight = Math.max(2, screen.height - 5 - (warning ? 1 : 0));

    return (
        <>
            <Text color={theme.muted} wrap="truncate-end">
                Show:{' '}
                <Text bold color={theme.accent}>
                    {enabled}
                </Text>{' '}
                · {count} services ·{' '}
                <Text bold color={theme.accent}>
                    e
                </Text>{' '}
                enabled/disabled
            </Text>
            <SearchHeader
                searching={searching}
                query={query}
                hint="/ to filter"
            />
            {warning && (
                <Text color={theme.development} wrap="truncate-end">
                    {warning}
                </Text>
            )}
            {count > 0 ? (
                <ServiceList
                    groups={filtered}
                    selected={selected}
                    height={listHeight}
                    details={screen.details}
                    statuses={screen.statuses}
                    defaultStatus={screen.defaultStatus}
                />
            ) : (
                <Text color={theme.foreground}>
                    {query || enabled !== 'All'
                        ? 'No matching services.'
                        : 'No services found.'}
                </Text>
            )}
        </>
    );
}

export default function ServicesScreen(props: Props) {
    const browser = useServiceBrowser(props);

    return (
        <Box height={props.height} flexDirection="column">
            <Box flexDirection="column" marginTop={1}>
                <ServiceBrowserContent screen={props} browser={browser} />
            </Box>
            <Box flexGrow={1} />
            <KeyboardHints>
                {browser.searching
                    ? 'Type to filter · ↑ ↓ navigate · Esc finish · Ctrl+C quit'
                    : '↑ ↓ select · Enter actions · c container · e state · / filter · Tab tabs · q quit'}
            </KeyboardHints>
        </Box>
    );
}
