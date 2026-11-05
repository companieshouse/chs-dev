import type { Tab } from './navigation.js';

const screenReservations: Record<Tab, { reserved: number; minimum: number }> = {
    Services: { reserved: 6, minimum: 4 },
    Containers: { reserved: 6, minimum: 4 },
    Modules: { reserved: 8, minimum: 6 },
    Enabled: { reserved: 6, minimum: 2 },
    Journeys: { reserved: 6, minimum: 2 },
    Logs: { reserved: 6, minimum: 3 },
    Config: { reserved: 8, minimum: 4 },
};

export function screenHeight(rows: number, tab: Tab) {
    const { reserved, minimum } = screenReservations[tab];
    return Math.max(minimum, rows - reserved);
}
