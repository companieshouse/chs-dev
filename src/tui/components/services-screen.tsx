import SearchHeader from './search-header.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import { Text, useApp, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { useState } from 'react';
import type { ServiceGroup, ServiceDetails } from '../../domain/services.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import {
    filterServices,
    type ServiceEnabledFilter,
} from '../../domain/service-filter.js';
import ServiceList, { serviceVersion } from './service-list.js';
import { tabDirection } from '../models/navigation.js';
import { useSearch } from '../hooks/use-search.js';
import ServiceSelectionDetails from './service-selection-details.js';
import { middleEllipsis, plural } from '../models/formatting.js';
import type { LiveState } from '../../domain/live.js';
import type { EnvironmentSummary } from '../../domain/environment.js';
import TabScreen from './tab-screen.js';
import { footerBindingsForTab } from '../models/keymap.js';
import { wrapText } from '../models/environment.js';

interface Props {
    active: boolean;
    height: number;
    width?: number;
    live?: LiveState;
    environment?: EnvironmentSummary;
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

type ScreenProps = Props & { width: number };
type Selection = { filtered: ServiceGroup[]; name: string | undefined };

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

function useServiceBrowser(props: ScreenProps, onDetails: () => void) {
    const { exit } = useApp();
    const { query, searching, setQuery, setSearching, clear } = useSearch();
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
        clear();
        if (enabled !== 'All') setEnabled('All');
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
    const name = names[selection];
    const viewport = serviceViewport(props, { filtered, name });
    const pageSize = Math.max(1, viewport.listHeight - 2);
    const shortcuts = new Map<string, () => void>([
        ['e', cycleEnabled],
        ['i', () => name && onDetails()],
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
            const step = selectionStep(key, pageSize);
            if (step !== undefined) {
                setSearching(false);
                setSelected((current) => {
                    const next = Math.min(current, names.length - 1) + step;
                    return Math.max(0, Math.min(names.length - 1, next));
                });
                return;
            }
            if (key.escape) return escape();
            if (searching) return search(input, key);
            if (input === '/') {
                setSearching(true);
                return;
            }
            const shortcut = shortcuts.get(input);
            if (shortcut && !key.ctrl && !key.meta) return shortcut();
            runServiceCommand(input, key, name, props);
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
        name,
    };
}

function selectionStep(key: Key, pageSize: number): number | undefined {
    if (key.pageUp) return -pageSize;
    if (key.pageDown) return pageSize;
    if (key.upArrow) return -1;
    if (key.downArrow) return 1;
    return undefined;
}

function selectionContext(
    screen: Props,
    browser: Selection,
    width: number,
): string[] {
    const name = browser.name;
    if (!name) return [];
    const detail = screen.details[name];
    const group = browser.filtered.find((item) => item.services.includes(name));
    const lines = [
        `Selected: ${name}`,
        `${savedDescription(detail)} · Module: ${group?.name ?? '—'}`,
        ...appliedDescription(screen, name),
        ...versionDescription(detail),
    ];
    return lines.flatMap((line) => wrapText(line, width));
}

function savedDescription(
    detail: ServiceDetails = { enabled: 'Unknown', mode: 'Unknown' },
): string {
    const start =
        detail.effectiveStartMode ??
        detail.startModeOverride ??
        detail.startModeLabel ??
        '—';
    return `Saved: ${detail.enabled} ${detail.mode} · Start: ${start}`;
}

function appliedDescription(screen: Props, name: string): string[] {
    if (!screen.live) return [];
    const applied =
        screen.live.observed?.containers.find((item) => item.service === name)
            ?.mode ?? 'unobserved';
    return [
        `Applied mode (observed): ${applied} · Runtime: ${screen.statuses[name] ?? screen.defaultStatus}`,
        ...(screen.live.stoppedByUser.includes(name)
            ? ['Intent: manual stop; traffic will not start this service.']
            : []),
    ];
}

function versionDescription(detail?: ServiceDetails): string[] {
    const lines = [`Saved version: ${serviceVersion(detail)}`];
    if (detail?.image && detail.image !== serviceVersion(detail))
        lines.push(`Saved image: ${detail.image}`);
    if (detail?.mockScenario) lines.push(`Scenario: ${detail.mockScenario}`);
    if (
        detail?.versionSource &&
        detail.versionSource !== serviceVersion(detail)
    )
        lines.push(`Version source: ${detail.versionSource}`);
    return lines;
}

function environmentContext(
    live: LiveState,
    environment: EnvironmentSummary | undefined,
    width: number,
): string[] {
    const pending = live.changes?.edited ? 'saved changes' : 'none';
    const runtime = environment?.label ?? 'unavailable';
    const lines = [
        `Pending: ${pending} · Runtime: ${runtime} · Ctrl+E environment`,
    ];
    if (environment?.failed.length)
        lines.push(
            `Failing: ${middleEllipsis(environment.failed[0]!, Math.max(1, width - 38))}${environment.failed.length > 1 ? ` (+${environment.failed.length - 1})` : ''} · Ctrl+E details`,
        );
    return lines;
}

function serviceViewport(screen: ScreenProps, selection: Selection) {
    const warning =
        screen.stateError ||
        (screen.runtimeState === 'error'
            ? `${screen.runtimeName} status unavailable; retrying…`
            : '');
    const fullContext = selectionContext(screen, selection, screen.width);
    const summary = screen.live
        ? environmentContext(screen.live, screen.environment, screen.width)
        : [];
    const available = Math.max(
        1,
        screen.height - 6 - summary.length - (warning ? 1 : 0),
    );
    const context =
        fullContext.length > available
            ? [
                  ...fullContext.slice(0, available - 1),
                  'i details · full saved and observed values',
              ]
            : fullContext;
    const listHeight = Math.max(
        3,
        screen.height - 3 - context.length - (warning ? 1 : 0) - summary.length,
    );
    return { warning, context, summary, listHeight };
}

function ServiceBrowserContent({
    screen,
    browser,
}: {
    screen: ScreenProps;
    browser: ReturnType<typeof useServiceBrowser>;
}) {
    if (screen.loading)
        return <Text color={theme.foreground}>Loading services…</Text>;
    if (screen.error)
        return <Text color={theme.development}>{screen.error}</Text>;

    const { query, searching, enabled, selected, filtered, count } = browser;
    const { warning, context, summary, listHeight } = serviceViewport(
        screen,
        browser,
    );

    return (
        <>
            {summary.map((line) => (
                <Text key={line} color={theme.muted} wrap="truncate-end">
                    {line}
                </Text>
            ))}
            <Text color={theme.muted} wrap="truncate-end">
                Show: {enabled} · {plural(count, 'service')} · e
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
                    width={screen.width}
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
            <Text color={theme.muted}>{context.join('\n')}</Text>
        </>
    );
}

export default function ServicesScreen(props: Props) {
    const { columns } = useWindowSize();
    const screen = { ...props, width: props.width ?? columns };
    const [inspecting, setInspecting] = useState(false);
    const browser = useServiceBrowser(
        { ...screen, active: props.active && !inspecting },
        () => setInspecting(true),
    );
    if (inspecting)
        return (
            <ServiceSelectionDetails
                lines={selectionContext(screen, browser, screen.width)}
                height={props.height}
                active={props.active}
                onClose={() => setInspecting(false)}
                onOpen={() => browser.name && props.onOpen(browser.name)}
            />
        );

    return (
        <TabScreen
            height={props.height}
            footer={
                <KeyboardHints
                    bindings={footerBindingsForTab(
                        'Services',
                        browser.searching ? 'search' : 'normal',
                    )}
                />
            }
        >
            <ServiceBrowserContent screen={screen} browser={browser} />
        </TabScreen>
    );
}
