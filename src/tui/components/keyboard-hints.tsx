import { Text } from 'ink';
import { theme } from './theme.js';

export default function KeyboardHints({ children }: { children: string }) {
    const parts = children.split(
        /(↑ ↓|← →|Ctrl\+[A-Z]|\b(?:Enter|Space|Esc|Tab|PgUp|PgDn|[duqcevrsfxp])\b|\/)/g,
    );
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
