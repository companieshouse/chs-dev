import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import ModalFrame from './modal-frame.js';
import KeyboardHints from './keyboard-hints.js';
import { theme } from './theme.js';
import type { KeyBinding } from '../models/keymap.js';

export default function HelpModal({
    bindings,
    onClose,
}: {
    bindings: readonly KeyBinding[];
    onClose(): void;
}) {
    const [offset, setOffset] = useState(0);
    const pageSize = 12;
    const maxOffset = Math.max(0, bindings.length - pageSize);

    useInput((input, key) => {
        if (key.escape || input === 'q' || input === '?') return onClose();
        if (key.upArrow)
            setOffset((value) => Math.max(0, Math.min(maxOffset, value - 1)));
        if (key.downArrow) setOffset((value) => Math.min(maxOffset, value + 1));
        if (key.pageUp) setOffset((value) => Math.max(0, value - pageSize));
        if (key.pageDown)
            setOffset((value) => Math.min(maxOffset, value + pageSize));
    });

    return (
        <ModalFrame title="Keyboard shortcuts" width={72}>
            <Text color={theme.muted}>
                Shortcuts for the current screen and global navigation.
            </Text>
            <Box flexDirection="column" marginY={1}>
                {bindings
                    .slice(offset, offset + pageSize)
                    .map((item, index) => (
                        <Text key={`${item.key}-${index}`} wrap="truncate-end">
                            <Text bold color={theme.accent}>
                                {item.key.padEnd(12)}
                            </Text>
                            <Text color={theme.foreground}>{item.label}</Text>
                            {item.description && (
                                <Text color={theme.muted}>
                                    {' '}
                                    — {item.description}
                                </Text>
                            )}
                        </Text>
                    ))}
            </Box>
            {maxOffset > 0 && (
                <Text color={theme.muted}>
                    Showing {offset + 1}–
                    {Math.min(bindings.length, offset + pageSize)} of{' '}
                    {bindings.length}
                </Text>
            )}
            <KeyboardHints>
                ↑ ↓ PgUp PgDn scroll · Esc back · q close
            </KeyboardHints>
        </ModalFrame>
    );
}
