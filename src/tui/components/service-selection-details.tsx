import { Text, useInput } from 'ink';
import { useState } from 'react';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import TabScreen from './tab-screen.js';

/** Full saved/observed context for the current table selection. */
export default function ServiceSelectionDetails({
    lines,
    height,
    active,
    onClose,
    onOpen,
}: {
    lines: string[];
    height: number;
    active: boolean;
    onClose(): void;
    onOpen(): void;
}) {
    const [offset, setOffset] = useState(0);
    const capacity = Math.max(1, height - 2);
    const maximum = Math.max(0, lines.length - capacity);
    const start = Math.min(offset, maximum);
    useInput(
        (input, key) => {
            if (key.escape || input === 'i') return onClose();
            if (key.return) return onOpen();
            if (key.upArrow || key.pageUp)
                setOffset(Math.max(0, start - (key.pageUp ? capacity : 1)));
            if (key.downArrow || key.pageDown)
                setOffset(
                    Math.min(maximum, start + (key.pageDown ? capacity : 1)),
                );
        },
        { isActive: active },
    );
    return (
        <TabScreen
            height={height}
            footer={
                <KeyboardHints>
                    ↑↓ scroll · PgUp/PgDn page · Enter actions · Esc back
                </KeyboardHints>
            }
        >
            <Text bold color={theme.accent}>
                Service details · {start + 1}–
                {Math.min(start + capacity, lines.length)} of {lines.length}
            </Text>
            <Text color={theme.foreground}>
                {lines.slice(start, start + capacity).join('\n')}
            </Text>
        </TabScreen>
    );
}
