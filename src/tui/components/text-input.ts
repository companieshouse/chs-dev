import type { Key } from 'ink';

/**
 * Applies a key press to a single-line text value. Returns the new value, or
 * undefined when the key is not a text edit.
 */
export function editText(
    value: string,
    input: string,
    key: Pick<Key, 'backspace' | 'delete' | 'ctrl' | 'meta'>,
): string | undefined {
    if (key.backspace || key.delete) return value.slice(0, -1);
    if (key.ctrl && input === 'u') return '';
    if (key.ctrl || key.meta) return undefined;
    // Pasted text arrives as one input; keep printable characters only.
    const printable = input.replace(/[^\x20-\x7e]/g, '');
    return printable ? `${value}${printable}` : undefined;
}
