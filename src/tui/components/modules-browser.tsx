import SearchHeader from './search-header.js';
import { editText } from './text-input.js';
import SelectableRow from './selectable-row.js';
import { theme } from './theme.js';
import { tabDirection } from '../models/navigation.js';
import { Box, Text, useApp, useInput } from 'ink';
import type { Key } from 'ink';
import { useMemo, useReducer } from 'react';
import type { ServiceGroup } from '../../domain/services.js';
import { dependencyTree } from '../../domain/service-dependencies.js';
import type { DependencyTreeRow } from '../../domain/service-dependencies.js';
import { centeredStart, moduleRows } from '../models/modules.js';
import type { BrowserRow } from '../models/modules.js';

interface ModulesBrowserProps {
    groups: ServiceGroup[];
    active: boolean;
    height: number;
    onOpen: (name: string) => void;
}

const clampIndex = (count: number, index: number, step: number): number =>
    Math.max(0, Math.min(count - 1, index + step));

function ModuleColumn({
    rows,
    start,
    capacity,
    selected,
    focused,
}: {
    rows: BrowserRow[];
    start: number;
    capacity: number;
    selected: number;
    focused: boolean;
}) {
    return (
        <Box
            width="45%"
            flexDirection="column"
            borderStyle="round"
            borderColor={focused ? theme.accent : theme.border}
            paddingX={1}
        >
            <Text bold color={theme.columnHeading}>
                {focused ? '› ' : ''}Modules
            </Text>
            {rows.length === 0 && (
                <Text color={theme.foreground}>No matches.</Text>
            )}
            {rows.slice(start, start + capacity).map((row, index) => (
                <SelectableRow
                    key={`${row.kind}:${row.module}:${row.name}`}
                    selected={selected === start + index}
                    heading={row.kind === 'module'}
                >
                    {row.kind === 'module'
                        ? `${row.expanded ? '▾' : '▸'} ${row.name}`
                        : `  ${row.name}`}
                </SelectableRow>
            ))}
        </Box>
    );
}

function TreeColumn({
    focused,
    direction,
    isService,
    serviceName,
    rows,
    start,
    capacity,
    selected,
}: {
    focused: boolean;
    direction: 'dependencies' | 'dependents';
    isService: boolean;
    serviceName: string | undefined;
    rows: DependencyTreeRow[];
    start: number;
    capacity: number;
    selected: number;
}) {
    return (
        <Box
            width="55%"
            flexDirection="column"
            borderStyle="round"
            borderColor={focused ? theme.accent : theme.border}
            paddingX={1}
        >
            <Text bold color={theme.columnHeading} wrap="truncate-end">
                {focused ? '› ' : ''}
                {direction === 'dependencies'
                    ? 'Depends on [d]'
                    : 'Used by [u]'}
            </Text>
            <Text color={theme.foreground} wrap="truncate-end">
                {isService ? serviceName : 'Select a service to explore.'}
            </Text>
            {isService && rows.length === 0 && (
                <Text color={theme.muted}>
                    {direction === 'dependencies'
                        ? 'No dependencies.'
                        : 'No dependent services.'}
                </Text>
            )}
            {rows.slice(start, start + capacity).map((row, index) => (
                <SelectableRow
                    key={start + index}
                    selected={focused && selected === start + index}
                >
                    {`${row.prefix}${row.name}${row.reference ? ` (${row.reference})` : ''}`}
                </SelectableRow>
            ))}
        </Box>
    );
}

type ModuleState = {
    query: string;
    searching: boolean;
    expanded: Record<string, boolean>;
    selected: number;
    focused: 'browser' | 'tree';
    direction: 'dependencies' | 'dependents';
    treeSelected: number;
};
type ModuleAction =
    | { kind: 'filter'; query: string }
    | { kind: 'search'; active: boolean }
    | { kind: 'focus'; panel: ModuleState['focused'] }
    | { kind: 'move'; index: number }
    | { kind: 'direction'; direction: ModuleState['direction'] }
    | { kind: 'expand'; module: string };
const initialModuleState: ModuleState = {
    query: '',
    searching: false,
    expanded: {},
    selected: 0,
    focused: 'browser',
    direction: 'dependencies',
    treeSelected: 0,
};
function moduleTransition(
    state: ModuleState,
    action: ModuleAction,
): ModuleState {
    switch (action.kind) {
        case 'filter':
            return {
                ...state,
                query: action.query,
                selected: 0,
                treeSelected: 0,
                expanded: {},
            };
        case 'search':
            return { ...state, searching: action.active };
        case 'focus':
            return { ...state, focused: action.panel, searching: false };
        case 'direction':
            return { ...state, direction: action.direction, treeSelected: 0 };
        case 'expand':
            return {
                ...state,
                expanded: {
                    ...state.expanded,
                    [action.module]: !state.expanded[action.module],
                },
            };
        case 'move':
            return state.focused === 'browser'
                ? {
                      ...state,
                      selected: action.index,
                      treeSelected: 0,
                      searching: false,
                  }
                : { ...state, treeSelected: action.index, searching: false };
    }
}
function moduleKey(input: string, key: Key) {
    if (tabDirection(input, key, true) !== null) return 'tab';
    if (key.tab) return 'focus';
    if (key.upArrow || key.downArrow) return 'move';
    if (key.escape) return 'escape';
    if (key.return) return 'activate';
    return input;
}
function modulePresentation(
    state: ModuleState,
    browser: BrowserRow[],
    tree: DependencyTreeRow[],
    height: number,
) {
    const selected = Math.min(state.selected, Math.max(0, browser.length - 1));
    const treeSelected = Math.min(
        state.treeSelected,
        Math.max(0, tree.length - 1),
    );
    const current = browser[selected];
    const capacity = Math.max(1, height - 5);
    return {
        search: { query: state.query, searching: state.searching },
        browserView: {
            rows: browser,
            start: centeredStart(selected, capacity, browser.length),
            capacity,
            selected,
            focused: state.focused === 'browser',
        },
        treeView: {
            rows: tree,
            start: centeredStart(treeSelected, capacity, tree.length),
            capacity,
            selected: treeSelected,
            focused: state.focused === 'tree',
            direction: state.direction,
            isService: current?.kind === 'service',
            serviceName: current?.kind === 'service' ? current.name : undefined,
        },
    };
}
function activateModule(
    focused: ModuleState['focused'],
    {
        current,
        entry,
        groups,
    }: {
        current: BrowserRow | undefined;
        entry: DependencyTreeRow | undefined;
        groups: ServiceGroup[];
    },
    dispatch: (action: ModuleAction) => void,
    onOpen: (name: string) => void,
) {
    if (focused === 'tree') {
        if (
            entry &&
            groups.some((group) => group.services.includes(entry.name))
        )
            onOpen(entry.name);
    } else if (current?.kind === 'module')
        dispatch({ kind: 'expand', module: current.module });
    else if (current) onOpen(current.name);
}

function moduleSelection(
    focused: ModuleState['focused'],
    view: ReturnType<typeof modulePresentation>,
    step: number,
) {
    const panel = focused === 'browser' ? view.browserView : view.treeView;
    return clampIndex(panel.rows.length, panel.selected, step);
}

function escapeModule(
    state: ModuleState,
    dispatch: (action: ModuleAction) => void,
    exit: () => void,
) {
    if (state.searching) dispatch({ kind: 'search', active: false });
    else if (state.query) dispatch({ kind: 'filter', query: '' });
    else if (state.focused === 'tree')
        dispatch({ kind: 'focus', panel: 'browser' });
    else exit();
}

function moduleSearchAction(
    query: string,
    input: string,
    key: Key,
): ModuleAction | undefined {
    if (key.return) return { kind: 'search', active: false };
    const value = editText(query, input, key);
    if (value !== undefined) return { kind: 'filter', query: value };
    return undefined;
}

function useModuleBrowser({
    groups,
    active,
    height,
    onOpen,
}: ModulesBrowserProps) {
    const { exit } = useApp();
    const [state, dispatch] = useReducer(moduleTransition, initialModuleState);
    const browser = useMemo(
        () => moduleRows(groups, state.query, state.expanded),
        [groups, state.query, state.expanded],
    );
    const current =
        browser[Math.min(state.selected, Math.max(0, browser.length - 1))];
    const tree = useMemo(
        () =>
            current?.kind === 'service'
                ? dependencyTree(current.name, groups, state.direction)
                : [],
        [current?.name, current?.kind, groups, state.direction],
    );
    const view = modulePresentation(state, browser, tree, height);
    const escape = () => escapeModule(state, dispatch, exit);
    const activate = () =>
        activateModule(
            state.focused,
            { current, entry: tree[view.treeView.selected], groups },
            dispatch,
            onOpen,
        );
    const commands: Record<string, () => void> = {
        tab: () => dispatch({ kind: 'search', active: false }),
        focus: () =>
            dispatch({
                kind: 'focus',
                panel: state.focused === 'browser' ? 'tree' : 'browser',
            }),
        escape,
        activate,
        q: exit,
        '/': () => {
            dispatch({ kind: 'focus', panel: 'browser' });
            dispatch({ kind: 'search', active: true });
            dispatch({ kind: 'filter', query: '' });
        },
        d: () => dispatch({ kind: 'direction', direction: 'dependencies' }),
        u: () => dispatch({ kind: 'direction', direction: 'dependents' }),
    };
    useInput(
        (input, key) => {
            const command = moduleKey(input, key);
            if (command === 'move') {
                dispatch({
                    kind: 'move',
                    index: moduleSelection(
                        state.focused,
                        view,
                        key.upArrow ? -1 : 1,
                    ),
                });
            } else if (
                state.searching &&
                !['tab', 'focus', 'escape'].includes(command)
            ) {
                const action = moduleSearchAction(state.query, input, key);
                if (action) dispatch(action);
            } else commands[command]?.();
        },
        { isActive: active },
    );
    return view;
}

export default function ModulesBrowser(props: ModulesBrowserProps) {
    const { search, browserView, treeView } = useModuleBrowser(props);
    return (
        <Box height={props.height} flexDirection="column">
            <SearchHeader {...search} hint="/ to filter modules and services" />
            <Box flexGrow={1}>
                <ModuleColumn {...browserView} />
                <TreeColumn {...treeView} />
            </Box>
        </Box>
    );
}
