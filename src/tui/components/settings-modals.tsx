import { useModalSave } from '../hooks/use-modal-save.js';
import { useAsyncAction } from '../hooks/use-async-action.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useState } from 'react';
import type {
    DiscoveredProfile,
    ProfileDiscovery,
} from '../../domain/aws-profiles.js';
import KeyboardHints from './keyboard-hints.js';
import ModalFrame, { modalListHeight } from './modal-frame.js';
import { centeredStart } from '../models/modules.js';
import SelectableRow from './selectable-row.js';
import Spinner from './spinner.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
function Messages({ lines }: { lines: (string | undefined)[] }) {
    return (
        <>
            {lines.filter(Boolean).map((line) => (
                <Text key={line} color={theme.development} wrap="wrap">
                    {line}
                </Text>
            ))}
        </>
    );
}

export interface Choice {
    /** `undefined` resets the setting to its default. */
    value: string | undefined;
    label: string;
}
export function ChoiceModal({
    title,
    detail,
    choices,
    current,
    loading,
    notes = [],
    onChoose,
    onClose,
}: {
    title: string;
    detail?: string;
    choices: Choice[];
    current: string | undefined;
    loading?: string;
    notes?: (string | undefined)[];
    onChoose(value: string | undefined): Promise<void>;
    onClose(): void;
}) {
    const { rows } = useWindowSize();
    const initial = Math.max(
        0,
        choices.findIndex((choice) => choice.value === current),
    );
    const [selected, setSelected] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const index = Math.min(selected, Math.max(0, choices.length - 1));
    useInput((input, key) => {
        if (busy) return;
        if (key.escape || input === 'q') return onClose();
        if (key.upArrow)
            setSelected((index - 1 + choices.length) % choices.length);
        else if (key.downArrow || key.tab)
            setSelected((index + 1) % choices.length);
        else if (key.return && choices[index]) {
            setBusy(true);
            setError('');
            onChoose(choices[index].value).then(onClose, (reason) => {
                setError(errorText(reason));
                setBusy(false);
            });
        }
    });
    const height = modalListHeight(rows, 9 + notes.filter(Boolean).length);
    const start = centeredStart(index, height, choices.length);
    return (
        <ModalFrame title={title}>
            {detail && (
                <Text color={theme.muted} wrap="wrap">
                    {detail}
                </Text>
            )}
            <Box flexDirection="column" marginY={1} flexShrink={1}>
                {loading && <Spinner label={loading} />}
                {choices.slice(start, start + height).map((choice, offset) => (
                    <SelectableRow
                        key={choice.label}
                        selected={start + offset === index}
                    >
                        {`${choice.value === current ? '(•)' : '( )'} ${choice.label}`}
                    </SelectableRow>
                ))}
            </Box>
            <Messages lines={notes} />
            {error && (
                <Text color={theme.error} wrap="wrap">
                    {error}
                </Text>
            )}
            <KeyboardHints>
                {busy ? 'Saving…' : '↑ ↓ choose · Enter select · Esc cancel'}
            </KeyboardHints>
        </ModalFrame>
    );
}

function checklistNotes(
    notes: (string | undefined)[],
    discovery: ProfileDiscovery | undefined,
): (string | undefined)[] {
    const unmatched = discovery?.unmatched.length
        ? `No local profile matches: ${discovery.unmatched.join(', ')}`
        : undefined;
    return [...notes, ...(discovery?.warnings ?? []), unmatched].filter(
        Boolean,
    );
}

function ProfileList({
    discovery,
    loadError,
    profiles,
    active,
    start,
    height,
    index,
    nameWidth,
}: {
    discovery: ProfileDiscovery | undefined;
    loadError?: string;
    profiles: DiscoveredProfile[];
    active: Set<string>;
    start: number;
    height: number;
    index: number;
    nameWidth: number;
}) {
    return (
        <>
            <Text color={theme.muted} wrap="wrap">
                AWS + registry login signs in to each checked profile's ECR
                registry. Profiles marked required match registries used by this
                project.
            </Text>
            <Box flexDirection="column" marginY={1} flexShrink={1}>
                {!discovery && !loadError && (
                    <Spinner label="Detecting AWS profiles and project registries…" />
                )}
                {loadError && <Text color={theme.error}>{loadError}</Text>}
                {discovery && !profiles.length && (
                    <Text color={theme.muted}>No AWS profiles found.</Text>
                )}
                {profiles
                    .slice(start, start + height)
                    .map((profile, offset) => (
                        <SelectableRow
                            key={profile.name}
                            selected={start + offset === index}
                        >
                            {`${active.has(profile.name) ? '[x]' : '[ ]'} ${profile.name.padEnd(nameWidth)}  ${(profile.region ?? '').padEnd(10)}${profile.required ? '  required' : profile.registries.length ? '  matches' : ''}`}
                        </SelectableRow>
                    ))}
            </Box>
        </>
    );
}

function profileMoveForward(key: import('ink').Key) {
    return key.downArrow || key.tab;
}
function profileClose(input: string, key: import('ink').Key) {
    return key.escape || input === 'q';
}

function checklistPresentation(
    {
        discovery,
        loadError,
        notes,
        profiles,
        active,
        index,
        rows,
    }: {
        discovery: ProfileDiscovery | undefined;
        loadError: string | undefined;
        notes: (string | undefined)[];
        profiles: ProfileDiscovery['profiles'];
        active: Set<string>;
        index: number;
        rows: number;
    },
    error: string,
    busy: boolean,
) {
    const allNotes = checklistNotes(notes, discovery);
    const height = modalListHeight(rows, 10 + allNotes.length);
    const start = centeredStart(index, height, profiles.length);
    const nameWidth = Math.min(
        36,
        Math.max(8, ...profiles.map((profile) => profile.name.length)),
    );
    return {
        profileList: {
            discovery,
            loadError,
            profiles,
            active,
            start,
            height,
            index,
            nameWidth,
        },
        allNotes,
        error,
        busy,
    };
}

function defaultProfiles(
    configured: readonly string[] | undefined,
    discovery: ProfileDiscovery | undefined,
) {
    return new Set(configured?.length ? configured : discovery?.recommended);
}

function useProfileChecklist({
    discovery,
    loadError,
    configured,
    notes = [],
    onSave,
    onClose,
}: {
    discovery?: ProfileDiscovery;
    loadError?: string;
    configured?: readonly string[];
    notes?: (string | undefined)[];
    onSave(profiles: string[] | undefined): Promise<void>;
    onClose(): void;
}) {
    const { rows } = useWindowSize();
    const [selected, setSelected] = useState(0);
    const [checked, setChecked] = useState<Set<string>>();
    const action = useAsyncAction<'save'>();
    const [validation, setValidation] = useState('');
    const busy = !!action.busy;
    const error =
        validation ||
        (action.notice?.ok === false ? action.notice.message : '');
    const profiles = discovery?.profiles ?? [];
    // Pre-select once discovery has finished, unless the user saved a list.
    const active = checked ?? defaultProfiles(configured, discovery);
    const index = Math.min(selected, Math.max(0, profiles.length - 1));
    const save = (value: string[] | undefined) => {
        setValidation('');
        void action.run('save', async () => {
            await onSave(value);
            onClose();
            return { ok: true, message: '' };
        });
    };
    const toggle = () => {
        if (!profiles[index]) return;
        const next = new Set(active);
        const name = profiles[index].name;
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setChecked(next);
    };
    const commit = () => {
        const value = profiles
            .map((profile) => profile.name)
            .filter((name) => active.has(name));
        if (!value.length) {
            setValidation(
                'Select at least one profile, or press r for automatic detection.',
            );
            return;
        }
        save(value);
    };
    useInput((input, key) => {
        if (busy) return;
        if (profileClose(input, key)) return onClose();
        if (!discovery) return;
        if (key.upArrow && profiles.length)
            setSelected((index - 1 + profiles.length) % profiles.length);
        else if (profileMoveForward(key) && profiles.length)
            setSelected((index + 1) % profiles.length);
        else {
            const command = key.return
                ? commit
                : { ' ': toggle, r: () => save(undefined) }[input];
            command?.();
        }
    });
    return checklistPresentation(
        { discovery, loadError, notes, profiles, active, index, rows },
        error,
        busy,
    );
}
export function ProfileChecklistModal({
    discovery,
    loadError,
    configured,
    notes = [],
    onSave,
    onClose,
}: {
    discovery?: ProfileDiscovery;
    loadError?: string;
    configured?: readonly string[];
    notes?: (string | undefined)[];
    onSave(profiles: string[] | undefined): Promise<void>;
    onClose(): void;
}) {
    const { profileList, allNotes, error, busy } = useProfileChecklist({
        discovery,
        loadError,
        configured,
        notes,
        onSave,
        onClose,
    });
    return (
        <ModalFrame title="ECR login profiles">
            <ProfileList {...profileList} />
            <Messages lines={allNotes} />
            {error && (
                <Text color={theme.error} wrap="wrap">
                    {error}
                </Text>
            )}
            <KeyboardHints>
                {busy
                    ? 'Saving…'
                    : '↑ ↓ choose · Space toggle · Enter save · r automatic · Esc cancel'}
            </KeyboardHints>
        </ModalFrame>
    );
}

export function TextInputModal({
    title,
    detail,
    label,
    initial,
    notes = [],
    validate,
    onSave,
    onClose,
}: {
    title: string;
    detail: string;
    label: string;
    initial: string;
    notes?: (string | undefined)[];
    validate(value: string): Promise<string | undefined>;
    onSave(value: string | undefined): Promise<void>;
    onClose(): void;
}) {
    const [value, setValue] = useState(initial);
    const save = useModalSave(async () => {
        const trimmed = value.trim();
        const problem = trimmed ? await validate(trimmed) : undefined;
        if (problem) throw new Error(problem);
        await onSave(trimmed || undefined);
    }, onClose);
    const { busy, error } = save;
    useInput((input, key) => {
        if (busy) return;
        if (key.escape) return onClose();
        if (key.return) {
            void save.submit();
            return;
        }
        const next = editText(value, input, key);
        if (next !== undefined) setValue(next);
    });
    return (
        <ModalFrame title={title}>
            <Text color={theme.muted} wrap="wrap">
                {detail}
            </Text>
            <Box marginY={1}>
                <Text color={theme.foreground} wrap="truncate-start">
                    {label}: {value}
                    <Text color={theme.accent}>▌</Text>
                </Text>
            </Box>
            <Messages lines={notes} />
            {error && (
                <Text color={theme.error} wrap="wrap">
                    {error}
                </Text>
            )}
            <KeyboardHints>
                {busy
                    ? 'Checking…'
                    : 'Type · Enter save (empty resets) · Ctrl+U clear · Esc cancel'}
            </KeyboardHints>
        </ModalFrame>
    );
}
