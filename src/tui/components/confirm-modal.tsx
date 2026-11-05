import { Text, useInput } from 'ink';
import { useState } from 'react';
import ModalFrame from './modal-frame.js';
import SelectableRow from './selectable-row.js';
import KeyboardHints from './keyboard-hints.js';
import { theme } from './theme.js';

export default function ConfirmModal({
    title,
    message,
    confirmLabel,
    cancelLabel = 'Cancel',
    defaultOption = 'cancel',
    active = true,
    onConfirm,
    onCancel,
}: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    /** Which row starts selected: `cancel` (safe default) or `confirm`. */
    defaultOption?: 'cancel' | 'confirm';
    active?: boolean;
    onConfirm(): void;
    onCancel(): void;
}) {
    const [selected, setSelected] = useState(
        defaultOption === 'confirm' ? 1 : 0,
    );
    const options = [cancelLabel, confirmLabel];
    useInput(
        (input, key) => {
            if (key.escape || input === 'n' || input === 'q') return onCancel();
            if (input === 'y') return onConfirm();
            if (key.upArrow || key.downArrow)
                setSelected((value) => (value === 0 ? 1 : 0));
            if (key.return) {
                if (selected === 0) onCancel();
                else onConfirm();
            }
        },
        { isActive: active },
    );
    return (
        <ModalFrame title={title} width={64}>
            <Text color={theme.foreground} wrap="wrap">
                {message}
            </Text>
            <SelectableRow selected={selected === 0}>
                {options[0]}
            </SelectableRow>
            <SelectableRow selected={selected === 1}>
                {options[1]}
            </SelectableRow>
            <KeyboardHints>
                ↑ ↓ choose · Enter select · y confirm · Esc cancel
            </KeyboardHints>
        </ModalFrame>
    );
}
