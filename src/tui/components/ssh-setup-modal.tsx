import ModalFrame from './modal-frame.js';
import { editText } from './text-input.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { useReducer } from 'react';
import type { SshSetupStatus } from '../../domain/live.js';
import KeyboardHints from './keyboard-hints.js';
import SelectableRow from './selectable-row.js';
import { theme } from './theme.js';

type Step =
    | 'choose-key'
    | 'key-path'
    | 'repair'
    | 'passphrase-choice'
    | 'passphrase-input';

type SetupInput = {
    keyPath: string;
    passphrase: string;
    replace: boolean;
};

function labelPath(path: string): string {
    if (path.length <= 48) return path;
    return `…${path.slice(-47)}`;
}

function menuOptions(step: Step, candidate: string | undefined): string[] {
    if (step === 'choose-key')
        return [
            candidate
                ? `Use ${labelPath(candidate)}`
                : 'Use detected key (unavailable)',
            'Enter SSH key path',
            'Cancel',
        ];
    if (step === 'repair')
        return ['Repair existing container secret files', 'Back'];
    if (step === 'passphrase-choice')
        return ['Key has a passphrase', 'Key has no passphrase', 'Back'];
    if (step === 'passphrase-input') return ['Save passphrase', 'Back'];
    return ['Continue', 'Back'];
}

function stepDetail(step: Step, message: string): string | undefined {
    if (step === 'choose-key') return message;
    if (step === 'key-path')
        return 'Type the path to the private key. The key is linked, never copied.';
    if (step === 'repair')
        return 'Existing setup will only be replaced after you choose Repair.';
    if (step === 'passphrase-choice') return 'Does the key have a passphrase?';
    return 'Passphrases are entered only into this TUI and are not logged.';
}

function backStep(step: Step, needsRepair: boolean): Step {
    if (step === 'key-path' || step === 'repair') return 'choose-key';
    return step === 'passphrase-input'
        ? 'passphrase-choice'
        : needsRepair
          ? 'repair'
          : 'choose-key';
}

type SetupState = {
    step: Step;
    selected: number;
    keyPath: string;
    passphrase: string;
    replace: boolean;
    busy: boolean;
    error: string;
};
type SetupAction =
    | { kind: 'go'; step: Step }
    | { kind: 'key'; value: string; replace: boolean }
    | { kind: 'edit-key' | 'edit-passphrase' | 'error'; value: string }
    | { kind: 'select'; index: number }
    | { kind: 'busy'; busy: boolean };
function setupTransition(state: SetupState, action: SetupAction): SetupState {
    switch (action.kind) {
        case 'go':
            return { ...state, step: action.step, selected: 0, error: '' };
        case 'key':
            return {
                ...state,
                keyPath: action.value,
                replace: action.replace,
                step: action.replace ? 'repair' : 'passphrase-choice',
                selected: 0,
                error: '',
            };
        case 'edit-key':
            return { ...state, keyPath: action.value };
        case 'edit-passphrase':
            return { ...state, passphrase: action.value };
        case 'error':
            return { ...state, error: action.value };
        case 'select':
            return { ...state, selected: action.index };
        case 'busy':
            return { ...state, busy: action.busy };
    }
}
type SetupCommand =
    | 'candidate'
    | 'path'
    | 'close'
    | 'repair'
    | 'back'
    | 'phrase'
    | 'empty'
    | 'submit';
const menus: Partial<Record<Step, SetupCommand[]>> = {
    'choose-key': ['candidate', 'path', 'close'],
    repair: ['repair', 'back'],
    'passphrase-choice': ['phrase', 'empty', 'back'],
    'passphrase-input': ['submit', 'back'],
};
function setupInputLine(step: Step, keyPath: string, passphrase: string) {
    if (step === 'key-path') return `Key path: ${keyPath || '▌'}`;
    if (step === 'passphrase-input')
        return `Passphrase: ${'*'.repeat(passphrase.length)}▌`;
    return undefined;
}
function setupNavigation(key: Key) {
    return key.upArrow || key.downArrow || key.tab;
}
function setupCommands(
    {
        state,
        candidate,
        needsRepair,
    }: {
        state: SetupState;
        candidate: string | undefined;
        needsRepair: boolean;
    },
    dispatch: (action: SetupAction) => void,
    actions: {
        go(step: Step): void;
        chooseKey(value: string): void;
        submit(value: string): Promise<void>;
        close(): void;
    },
): Record<SetupCommand, () => void> {
    return {
        candidate: () => {
            if (candidate) actions.chooseKey(candidate);
            else
                dispatch({
                    kind: 'error',
                    value: 'No usable key was detected. Enter its path instead.',
                });
        },
        path: () => {
            dispatch({ kind: 'edit-key', value: '' });
            actions.go('key-path');
        },
        close: actions.close,
        repair: () => {
            actions.chooseKey(state.keyPath);
            actions.go('passphrase-choice');
        },
        back: () => actions.go(backStep(state.step, needsRepair)),
        phrase: () => {
            dispatch({ kind: 'edit-passphrase', value: '' });
            actions.go('passphrase-input');
        },
        empty: () => void actions.submit(''),
        submit: () => void actions.submit(state.passphrase),
    };
}
function setupTextInput(step: Step, key: Key) {
    return step === 'key-path' || (step === 'passphrase-input' && !key.return);
}
function setupBackward(key: Key) {
    return key.upArrow || (key.tab && key.shift);
}
function setupClose(input: string, key: Key) {
    return key.escape || input === 'q';
}

function useSetupInput(
    state: SetupState,
    count: number,
    dispatch: (action: SetupAction) => void,
    actions: {
        edit(input: string, key: Key): void;
        close(): void;
        commands: Record<SetupCommand, () => void>;
    },
) {
    useInput((input, key) => {
        if (state.busy) return;
        if (setupClose(input, key))
            return state.step === 'choose-key'
                ? actions.close()
                : actions.commands.back();
        if (setupTextInput(state.step, key)) return actions.edit(input, key);
        if (setupNavigation(key)) {
            const backward = setupBackward(key);
            dispatch({
                kind: 'select',
                index: (state.selected + (backward ? count - 1 : 1)) % count,
            });
        } else if (key.return) {
            const command = menus[state.step]?.[state.selected];
            if (command) actions.commands[command]();
        }
    });
}
function editSetup(
    state: SetupState,
    dispatch: (action: SetupAction) => void,
    chooseKey: (value: string) => void,
    input: string,
    key: Key,
) {
    if (state.step === 'key-path' && key.return) {
        if (state.keyPath.trim()) chooseKey(state.keyPath);
        else
            dispatch({
                kind: 'error',
                value: 'Enter an SSH private key path.',
            });
        return;
    }
    const kind = state.step === 'key-path' ? 'edit-key' : 'edit-passphrase';
    const value = editText(
        kind === 'edit-key' ? state.keyPath : state.passphrase,
        input,
        key,
    );
    if (value !== undefined) dispatch({ kind, value });
}
function useSshSetupFlow({
    status,
    onSetup,
    onClose,
}: {
    status: SshSetupStatus;
    onSetup(input: SetupInput): Promise<boolean>;
    onClose(): void;
}) {
    const candidate = status.existingKey ?? status.discoveredKey;
    const needsRepair =
        status.keyState === 'invalid' ||
        status.passphraseState === 'invalid' ||
        (status.keyState === 'missing' && status.passphraseState === 'valid');
    const [state, dispatch] = useReducer(setupTransition, {
        step: 'choose-key',
        selected: 0,
        keyPath: candidate ?? '',
        passphrase: '',
        replace: needsRepair,
        busy: false,
        error: '',
    });
    const options = menuOptions(state.step, candidate);
    const go = (step: Step) => dispatch({ kind: 'go', step });
    const submit = async (passphrase: string) => {
        dispatch({ kind: 'busy', busy: true });
        dispatch({ kind: 'error', value: '' });
        try {
            if (
                await onSetup({
                    keyPath: state.keyPath,
                    passphrase,
                    replace: state.replace,
                })
            )
                onClose();
        } catch (error) {
            dispatch({
                kind: 'error',
                value: error instanceof Error ? error.message : String(error),
            });
        } finally {
            dispatch({ kind: 'busy', busy: false });
        }
    };
    const chooseKey = (value: string) =>
        dispatch({
            kind: 'key',
            value,
            replace:
                needsRepair ||
                (Boolean(status.existingKey) && value !== status.existingKey),
        });
    const commands = setupCommands(
        { state, candidate, needsRepair },
        dispatch,
        { go, chooseKey, submit, close: onClose },
    );
    const edit = (input: string, key: Key) =>
        editSetup(state, dispatch, chooseKey, input, key);
    useSetupInput(state, options.length, dispatch, {
        edit,
        close: onClose,
        commands,
    });
    return {
        step: state.step,
        selected: state.selected,
        options,
        error: state.error,
        inputLine: setupInputLine(state.step, state.keyPath, state.passphrase),
    };
}

function requiredServices(status: SshSetupStatus) {
    return (
        status.requirements[0]?.services.join(', ') ||
        'selected development services'
    );
}

export default function SshSetupModal({
    status,
    errorMessage,
    onSetup,
    onClose,
}: {
    status: SshSetupStatus;
    errorMessage?: string;
    onSetup(input: SetupInput): Promise<boolean>;
    onClose(): void;
}) {
    const flow = useSshSetupFlow({ status, onSetup, onClose });
    const { step, options, selected, inputLine, error } = flow;
    const detail = stepDetail(step, status.message);
    return (
        <ModalFrame title="Set up SSH access">
            <Text color={theme.muted} wrap="wrap">
                {detail}
            </Text>
            {inputLine && (
                <Text color={theme.foreground} wrap="truncate-end">
                    {inputLine}
                </Text>
            )}
            <Box flexDirection="column" marginY={1}>
                {options.map((option, index) => (
                    <SelectableRow key={option} selected={selected === index}>
                        {option}
                    </SelectableRow>
                ))}
            </Box>
            {(error || errorMessage) && (
                <Text color={theme.error} wrap="wrap">
                    {error || errorMessage}
                </Text>
            )}
            <Text color={theme.muted} wrap="wrap">
                Required by: {requiredServices(status)}
            </Text>
            <KeyboardHints>
                {step === 'key-path' || step === 'passphrase-input'
                    ? 'Type · Enter continue · Esc back'
                    : '↑ ↓ choose · Enter select · Esc cancel'}
            </KeyboardHints>
        </ModalFrame>
    );
}
