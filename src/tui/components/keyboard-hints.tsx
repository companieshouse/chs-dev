import { Text } from 'ink';
import { theme } from './theme.js';
import { bindingText, type KeyBinding } from '../models/keymap.js';

const keyPattern =
    /((?:(?:Ctrl|Alt|Shift)\+)?[A-Za-z](?:\/[A-Za-z])?|\?|\/|↑ ↓|← →|PgUp PgDn|Enter|Space|Esc|Tab|End|Home)(?=\s|·|$)/g;

function highlightedParts(text: string) {
    const parts = text.split(keyPattern);
    return (
        <Text color={theme.muted} wrap="truncate-end">
            {parts.map((part, index) => (
                <Text
                    key={index}
                    bold={index % 2 === 1}
                    color={index % 2 ? theme.accent : theme.muted}
                >
                    {part}
                </Text>
            ))}
        </Text>
    );
}

export default function KeyboardHints({
    children,
    bindings,
}: {
    children?: string;
    bindings?: readonly KeyBinding[];
}) {
    const text = bindings ? bindingText(bindings) : (children ?? '');
    return highlightedParts(text);
}
