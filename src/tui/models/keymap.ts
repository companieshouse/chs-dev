import type { Tab } from './navigation.js';
import type { Key } from 'ink';

export type KeymapContext = 'normal' | 'search';
export type GlobalKeyAction =
    'quick-login' | 'login-modal' | 'environment' | 'help' | 'quit';

export interface GlobalKeyContext {
    loginPreference: string | undefined;
    tab: Tab;
    localInputReady: boolean;
    searching: boolean;
}

const localQuitTabs = new Set<Tab>([
    'Services',
    'Containers',
    'Modules',
    'Enabled',
    'Logs',
]);
const searchableTabs = new Set<Tab>([
    'Services',
    'Containers',
    'Modules',
    'Enabled',
    'Logs',
]);

export function supportsSearch(tab: Tab) {
    return searchableTabs.has(tab);
}

export interface KeyBinding {
    key: string;
    label: string;
    description?: string;
    group?: string;
}

export function binding(
    key: string,
    label: string,
    description?: string,
    group?: string,
): KeyBinding {
    return { key, label, description, group };
}

function globalBindings(tab: Tab): KeyBinding[] {
    return [
        binding('Ctrl+N/P', 'switch tabs'),
        binding('Ctrl+Tab', 'switch tabs'),
        binding('← →', 'switch tabs'),
        ...(tab === 'Modules' ? [] : [binding('Tab', 'switch tabs')]),
        binding('?', 'help'),
        binding('q', 'quit'),
    ];
}

export function bindingsForTab(
    tab: Tab,
    context: KeymapContext = 'normal',
): KeyBinding[] {
    const screen: Record<Tab, KeyBinding[]> = {
        Services: [
            binding('↑ ↓', 'select'),
            binding('PgUp PgDn', 'page'),
            binding('i', 'details'),
            binding('Enter', 'actions'),
            binding('c', 'container'),
            binding('e', 'state filter'),
            binding('/', 'filter'),
        ],
        Containers: [
            binding('↑ ↓', 'select'),
            binding('Enter', 'details'),
            binding('a', 'scope'),
            binding('/', 'filter'),
            binding('r', 'refresh'),
        ],
        Modules: [
            binding('↑ ↓', 'browse'),
            binding('Tab', 'panel'),
            binding('Enter', 'expand/actions'),
            binding('/', 'filter'),
            binding('d', 'depends on'),
            binding('u', 'used by'),
        ],
        Enabled: [
            binding('↑ ↓', 'browse'),
            binding('Enter', 'actions'),
            binding('/', 'filter'),
        ],
        Journeys: [
            binding('↑ ↓', 'select'),
            binding('Enter', 'edit'),
            binding('n', 'new journey'),
            binding('s', 'switch to'),
            binding('d', 'delete'),
            binding('c', 'clear usage cache'),
        ],
        Logs: [
            binding('↑ ↓', 'scroll'),
            binding('PgUp PgDn', 'page'),
            binding('f', 'follow'),
            binding('c', 'filter'),
            binding('C', 'previous filter'),
            binding('/', 'search'),
            binding('v', 'detail'),
            binding('r', 'raw'),
            binding('s', 'source'),
            binding('End', 'follow tail'),
        ],
        Config: [binding('↑ ↓', 'choose'), binding('Enter', 'edit')],
    };
    if (context === 'search')
        return [
            binding('Type', 'filter'),
            binding('Enter', 'finish'),
            binding('Esc', 'clear/leave'),
            binding('Ctrl+U', 'clear'),
            ...globalBindings(tab).filter(
                ({ key }) => key !== 'q' && key !== '?',
            ),
        ];
    return [...screen[tab], ...globalBindings(tab)];
}

export function bindingText(bindings: readonly KeyBinding[]) {
    return bindings.map(({ key, label }) => `${key} ${label}`).join(' · ');
}

export function globalKeyAction(
    input: string,
    key: Key,
    context: GlobalKeyContext,
): GlobalKeyAction | undefined {
    const loginAction = loginKeyAction(input, key, context.loginPreference);
    if (loginAction) return loginAction;
    if (key.ctrl && (input === 'e' || input === 'r')) return 'environment';
    if (context.searching && isSearchText(input)) return undefined;
    if (input === '?') return 'help';
    if (shouldQuit(input, context)) return 'quit';
    return undefined;
}

function loginKeyAction(
    input: string,
    key: Key,
    loginPreference: string | undefined,
) {
    if (!key.ctrl || input !== 'l') return undefined;
    return loginPreference === 'aws' || loginPreference === 'registry'
        ? ('quick-login' as const)
        : ('login-modal' as const);
}

function isSearchText(input: string) {
    return input === 'q' || input === '?';
}

function shouldQuit(input: string, context: GlobalKeyContext) {
    return (
        input === 'q' &&
        (!context.localInputReady || !localQuitTabs.has(context.tab))
    );
}

export function footerBindingsForTab(
    tab: Tab,
    context: KeymapContext = 'normal',
) {
    const bindings = bindingsForTab(tab, context);
    if (tab === 'Services') {
        const keys =
            context === 'search'
                ? ['Type', 'Enter', 'Esc', 'Ctrl+U']
                : ['↑ ↓', 'Enter', 'i', '/', '?', 'q'];
        return bindings.filter(({ key }) => keys.includes(key));
    }
    if (context === 'search')
        return bindings.filter(({ key }) =>
            ['Type', '↑ ↓', 'Enter', 'Esc', 'Ctrl+U', '← →', 'Tab'].includes(
                key,
            ),
        );
    const globalOrder = ['q', '?', '← →', 'Tab', 'Ctrl+N/P', 'Ctrl+Tab'];
    const globalKeys = new Set(globalOrder);
    const global = globalOrder
        .map((key) => bindings.find((binding) => binding.key === key))
        .filter((binding): binding is KeyBinding => binding !== undefined);
    const screen = bindings.filter(({ key }) => !globalKeys.has(key));
    return [...global, ...screen];
}
