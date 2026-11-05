import { Box, Text, useInput, useWindowSize } from 'ink';
import { useState } from 'react';
import ModalFrame, { modalListHeight } from './modal-frame.js';
import SelectableRow from './selectable-row.js';
import KeyboardHints from './keyboard-hints.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';
import { useSpinner } from '../hooks/use-spinner.js';
import ConfirmModal from './confirm-modal.js';

interface ControlStatus {
    busy: boolean;
    error: string;
    notice?: string;
}

export function ProfileStatus({ busy, error, notice }: ControlStatus) {
    const spinner = useSpinner(busy);
    return (
        <>
            {busy && (
                <Text color={theme.muted}>{spinner} Reading or saving…</Text>
            )}
            {error && (
                <Text color={theme.error} wrap="truncate-end">
                    {error}
                </Text>
            )}
            {notice && (
                <Text color={theme.healthy} wrap="truncate-end">
                    {notice}
                </Text>
            )}
        </>
    );
}

export function ProfileMenu({
    status,
    onSelect,
    onClose,
}: {
    status: ControlStatus;
    onSelect(action: 'export' | 'import'): void;
    onClose(): void;
}) {
    const [selected, setSelected] = useState(0);
    const actions = ['Export environment', 'Import environment', 'Back'];
    useInput((_input, key) => {
        if (status.busy) return;
        if (key.escape) return onClose();
        if (key.upArrow) setSelected((value) => (value + 2) % 3);
        if (key.downArrow) setSelected((value) => (value + 1) % 3);
        if (!key.return) return;
        if (selected === 2) return onClose();
        onSelect((['export', 'import'] as const)[selected]);
    });
    return (
        <ModalFrame title="Share environment">
            <Text color={theme.muted}>
                Share service selections, providers, scenarios and versions.
            </Text>
            <Box flexDirection="column" marginY={1}>
                {actions.map((action, index) => (
                    <SelectableRow key={action} selected={selected === index}>
                        {action}
                    </SelectableRow>
                ))}
            </Box>
            <ProfileStatus {...status} />
            <KeyboardHints>↑ ↓ choose · Enter select · Esc back</KeyboardHints>
        </ModalFrame>
    );
}

export function ProfileInput({
    title,
    initial,
    status,
    onSubmit,
    onClose,
}: {
    title: string;
    initial: string;
    status: ControlStatus;
    onSubmit(value: string): void;
    onClose(): void;
}) {
    const [value, setValue] = useState(initial);
    const [discardOpen, setDiscardOpen] = useState(false);
    useInput(
        (input, key) => {
            if (key.escape) {
                if (value !== initial) setDiscardOpen(true);
                else onClose();
                return;
            }
            if (status.busy) return;
            if (key.return) {
                if (value.trim()) onSubmit(value.trim());
                return;
            }
            const next = editText(value, input, key);
            if (next !== undefined) setValue(next);
        },
        { isActive: !discardOpen },
    );
    if (discardOpen)
        return (
            <ConfirmModal
                title="Discard environment path?"
                message="The path you entered has not been submitted."
                confirmLabel="Discard path"
                onConfirm={onClose}
                onCancel={() => setDiscardOpen(false)}
            />
        );
    return (
        <ModalFrame title={title}>
            <Text color={theme.foreground} wrap="truncate-start">
                {value}▌
            </Text>
            <ProfileStatus {...status} />
            <KeyboardHints>
                Enter continue · Ctrl+U clear · Esc back
            </KeyboardHints>
        </ModalFrame>
    );
}

export function ProfileReview({
    lines,
    status,
    onSave,
    onClose,
}: {
    lines: string[];
    status: ControlStatus;
    onSave(): void;
    onClose(): void;
}) {
    const { rows } = useWindowSize();
    const height = Math.min(lines.length, modalListHeight(rows, 12));
    const [offset, setOffset] = useState(0);
    const [selected, setSelected] = useState(1);
    const move = (step: number) =>
        setOffset((value) =>
            Math.max(0, Math.min(lines.length - height, value + step)),
        );
    useInput((_input, key) => {
        if (key.escape) return onClose();
        if (status.busy) return;
        if (key.pageDown) move(height);
        if (key.pageUp) move(-height);
        if (key.upArrow || key.downArrow || key.tab)
            setSelected((value) => 1 - value);
        if (!key.return) return;
        if (selected === 0) onSave();
        else onClose();
    });
    const visibleOffset = Math.min(offset, Math.max(0, lines.length - height));
    return (
        <ModalFrame title="Review environment import">
            <Text color={theme.muted}>
                Replaces service selections, providers, scenarios and versions.
            </Text>
            <Box
                flexDirection="column"
                height={height}
                overflow="hidden"
                marginY={1}
            >
                {lines
                    .slice(visibleOffset, visibleOffset + height)
                    .map((line, index) => (
                        <Text
                            key={index}
                            color={theme.foreground}
                            wrap="truncate-end"
                        >
                            {line}
                        </Text>
                    ))}
            </Box>
            <SelectableRow selected={selected === 0}>
                Save environment
            </SelectableRow>
            <SelectableRow selected={selected === 1}>Back</SelectableRow>
            <ProfileStatus {...status} />
            <Text color={theme.muted}>
                Saving leaves changes pending until Apply or Start.
            </Text>
            <KeyboardHints>
                ↑ ↓ choose · Enter select · PgUp/PgDn scroll · Esc back
            </KeyboardHints>
        </ModalFrame>
    );
}
