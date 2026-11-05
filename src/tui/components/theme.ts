type ThemeColor = string | undefined;

const colorDepth =
    typeof process.stdout.getColorDepth === 'function'
        ? process.stdout.getColorDepth()
        : 24;
const colorDisabled =
    process.env.NO_COLOR !== undefined ||
    process.env.TERM === 'dumb' ||
    (process.stdout.isTTY !== true && process.env.FORCE_COLOR === undefined);

function color(value: string, fallback: string): ThemeColor {
    if (colorDisabled || colorDepth < 2) return undefined;
    return colorDepth < 8 ? fallback : value;
}

export const theme = {
    background: color('#181820', 'black'),
    foreground: color('#E0DFEB', 'white'),
    muted: color('#9A94AA', 'gray'),
    disabled: color('#827F91', 'gray'),
    border: color('#514960', 'gray'),
    inactiveTabBorder: color('#494454', 'gray'),
    inactiveTabText: color('#A19BAF', 'gray'),
    columnHeading: color('#BEB6D1', 'white'),
    accent: color('#B9A0FF', 'magenta'),
    activeTabBackground: color('#7755C7', 'magenta'),
    activeTabText: color('#FFFFFF', 'white'),
    selectionBackground: color('#383047', 'magenta'),
    selectionText: color('#FFFFFF', 'white'),
    enabled: color('#57D9B1', 'green'),
    development: color('#F2C078', 'yellow'),
    healthy: color('#9ECE6A', 'green'),
    error: color('#F0788C', 'red'),
    mocked: color('#7DCFFF', 'cyan'),
} as const;

export function statusColor(status: string): ThemeColor {
    if (['Healthy', 'Running', 'Completed'].includes(status))
        return theme.healthy;
    if (['Unhealthy', 'Dead', 'Exited', 'Failed'].includes(status))
        return theme.error;
    if (['Starting', 'Restarting', 'Pending'].includes(status))
        return theme.development;
    return theme.muted;
}

export function statusGlyph(status: string): string {
    return ['Stopped', 'Loading…', 'Unknown'].includes(status) ? '○' : '●';
}
