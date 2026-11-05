export const theme = {
    background: '#181820',
    foreground: '#E0DFEB',
    muted: '#9A94AA',
    disabled: '#827F91',
    border: '#514960',
    inactiveTabBorder: '#494454',
    inactiveTabText: '#A19BAF',
    columnHeading: '#BEB6D1',
    accent: '#B9A0FF',
    activeTabBackground: '#7755C7',
    activeTabText: '#FFFFFF',
    selectionBackground: '#383047',
    selectionText: '#FFFFFF',
    enabled: '#57D9B1',
    development: '#F2C078',
    healthy: '#9ECE6A',
    error: '#F0788C',
    mocked: '#7DCFFF',
} as const;

export function statusColor(status: string): string {
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
