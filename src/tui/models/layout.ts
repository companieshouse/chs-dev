import type { Tab } from './navigation.js';

const screenReservations: Record<Tab, { reserved: number; minimum: number }> = {
    Services: { reserved: 4, minimum: 4 },
    Containers: { reserved: 4, minimum: 4 },
    Modules: { reserved: 6, minimum: 6 },
    Enabled: { reserved: 4, minimum: 2 },
    Journeys: { reserved: 4, minimum: 2 },
    Logs: { reserved: 4, minimum: 3 },
    Config: { reserved: 6, minimum: 4 },
};

export function screenHeight(rows: number, tab: Tab) {
    const { reserved, minimum } = screenReservations[tab];
    return Math.max(minimum, rows - reserved);
}
