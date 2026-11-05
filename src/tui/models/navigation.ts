import type { Key } from 'ink';

export const tabs = [
    'Services',
    'Containers',
    'Modules',
    'Enabled',
    'Journeys',
    'Logs',
    'Config',
] as const;
export type Tab = (typeof tabs)[number];

// Modules reserves plain Tab for moving between its panels.
export function tabDirection(
    input: string,
    key: Key,
    panelTab = false,
): number | null {
    const shortcut = controlTabDirection(input, key);
    if (shortcut !== null) return shortcut;
    if (key.leftArrow) return -1;
    if (key.rightArrow) return 1;
    if (key.tab && (key.ctrl || !panelTab)) return key.shift ? -1 : 1;
    return null;
}

export function nextTab(current: Tab, direction: number): Tab {
    return tabs[
        (tabs.indexOf(current) + direction + tabs.length) % tabs.length
    ]!;
}

function controlTabDirection(input: string, key: Key): number | null {
    if (!key.ctrl) return null;
    return ({ p: -1, n: 1 } as Record<string, number>)[input] ?? null;
}
