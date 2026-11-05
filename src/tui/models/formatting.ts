import { homedir } from 'node:os';

export function plural(count: number, singular: string) {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function runtimeDisplayName(name: string) {
    return name === 'Docker' ? 'Docker / Compose' : name;
}

export function middleEllipsis(value: string, maximum: number) {
    if (value.length <= maximum) return value;
    if (maximum <= 1) return '…'.slice(0, maximum);
    const left = Math.ceil((maximum - 1) / 2);
    const right = Math.floor((maximum - 1) / 2);
    return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function displayPath(
    value: string,
    maximum = Number.POSITIVE_INFINITY,
    home = homedir(),
) {
    const shortened =
        value === home || value.startsWith(`${home}/`)
            ? `~${value.slice(home.length)}`
            : value;
    return middleEllipsis(shortened, maximum);
}
