import { Box, Text, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { homedir } from 'node:os';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { OperationResult } from '../../domain/runtime-strategy.js';
import { useClient, useSession } from '../context.js';
const expandHome = (value: string) =>
    value.startsWith('~/')
        ? homedir() + value.slice(1)
        : value === '~'
          ? homedir()
          : value;
import KeyboardHints from './keyboard-hints.js';
import ModalFrame, { modalListHeight } from './modal-frame.js';
import { centeredStart } from '../models/modules.js';
import SelectableRow from './selectable-row.js';
import Spinner from './spinner.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';

const actions = [
    'Enter a path manually…',
    'Clone into a new location…',
    'Cancel',
] as const;

const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const displayPath = (path: string, home = homedir()) =>
    clean(
        path === home || path.startsWith(`${home}/`)
            ? `~${path.slice(home.length)}`
            : path,
    );
const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

interface Notice {
    text: string;
    error: boolean;
}

interface Candidate {
    directory: string;
    valid?: boolean;
    message?: string;
}
type Step =
    | { kind: 'list' }
    | { kind: 'manual' | 'clone'; value: string }
    | { kind: 'confirm'; directory: string; origin?: string }
    | { kind: 'cloning'; directory: string };

interface ProjectPickerModalProps {
    current: string | undefined;
    onSelect(directory: string): Promise<void>;
    onClone(destination: string): Promise<OperationResult>;
    onClose(): void;
}

interface ProjectActionsDeps {
    client: ReturnType<typeof useClient>;
    search: { current: AbortController | undefined };
    setBusy(value: boolean): void;
    setMessage(message: Notice | undefined): void;
    setStep(step: Step): void;
    addCandidate(directory: string): void;
    onSelect(directory: string): Promise<void>;
    onClone(destination: string): Promise<OperationResult>;
    onClose(): void;
}

interface PickerInputDeps {
    busy: boolean;
    step: Step;
    index: number;
    count: number;
    candidates: Candidate[];
    client: ReturnType<typeof useClient>;
    choose(directory: string, checkOrigin: boolean): void;
    clone(value: string): void;
    setStep: Dispatch<SetStateAction<Step>>;
    setSelected: Dispatch<SetStateAction<number>>;
    setMessage(message: Notice | undefined): void;
    search: { current: AbortController | undefined };
    onClose(): void;
}

function useProjectSearch(
    client: ReturnType<typeof useClient>,
    session: ReturnType<typeof useSession>,
) {
    const search = useRef<AbortController>(undefined);
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [searching, setSearching] = useState(true);
    const [visited, setVisited] = useState(0);
    const [truncated, setTruncated] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        search.current = controller;
        void client
            .query('project.search', {}, controller.signal)
            .catch(() => setSearching(false));
        return () => controller.abort();
    }, [client]);
    useEffect(() => {
        setCandidates(session.search.found);
        setSearching(session.search.searching);
        setVisited(session.search.visited);
        setTruncated(session.search.truncated);
    }, [session.search]);
    return { search, candidates, searching, visited, truncated, setCandidates };
}

function useProjectActions(deps: ProjectActionsDeps) {
    const {
        client,
        search,
        setBusy,
        setMessage,
        setStep,
        onSelect,
        onClone,
        onClose,
    } = deps;
    const choose = async (directory: string, checkOrigin: boolean) => {
        setBusy(true);
        setMessage(undefined);
        try {
            const config = await client.query('project.validate', {
                directory,
            });
            if (!config.valid) throw new Error(config.message);
            if (checkOrigin && !config.expectedOrigin) {
                setStep({ kind: 'confirm', directory, origin: config.origin });
                setBusy(false);
                return;
            }
            search.current?.abort();
            await onSelect(config.directory);
            onClose();
        } catch (error) {
            setMessage({ text: errorText(error), error: true });
            setBusy(false);
        }
    };
    const clone = async (value: string) => {
        const directory = expandHome(value.trim());
        setBusy(true);
        setMessage(undefined);
        try {
            const problem = (
                await client.query('project.cloneDestination', { directory })
            ).error;
            if (problem) {
                setMessage({ text: problem, error: true });
                setBusy(false);
                return;
            }
            search.current?.abort();
            setStep({ kind: 'cloning', directory });
            const result = await onClone(directory);
            if (result.outcome !== 'success') {
                setStep({ kind: 'clone', value });
                setMessage({
                    text: result.message,
                    error: result.outcome === 'failed',
                });
                setBusy(false);
                return;
            }
            deps.addCandidate(directory);
            void choose(directory, false);
        } catch (error) {
            setStep({ kind: 'clone', value });
            setMessage({ text: errorText(error), error: true });
            setBusy(false);
        }
    };
    return { choose, clone };
}

function submitManualProject(
    value: string,
    choose: PickerInputDeps['choose'],
    setMessage: PickerInputDeps['setMessage'],
) {
    const directory = expandHome(value.trim());
    if (!directory.startsWith('/')) {
        setMessage({
            text: 'Enter an absolute path or one starting with ~/.',
            error: true,
        });
        return;
    }
    choose(directory, true);
}

function usePickerInput(deps: PickerInputDeps): void {
    const {
        busy,
        step,
        index,
        count,
        candidates,
        client,
        choose,
        clone,
        setStep,
        setSelected,
        setMessage,
        search,
        onClose,
    } = deps;
    const chooseFromList = () => {
        const candidate = candidates[index];
        if (candidate) return choose(candidate.directory, false);
        const action = actions[index - candidates.length];
        setMessage(undefined);
        if (action === 'Cancel') {
            search.current?.abort();
            onClose();
        } else if (action?.startsWith('Enter'))
            setStep({ kind: 'manual', value: '' });
        else
            void client
                .query('project.defaultDestination', {})
                .then((path) =>
                    setStep({ kind: 'clone', value: displayPath(path) }),
                );
    };
    const handleListKey = (input: string, key: Key) => {
        if (key.escape || input === 'q') {
            search.current?.abort();
            onClose();
        } else if (key.upArrow) setSelected((index - 1 + count) % count);
        else if (key.downArrow || key.tab) setSelected((index + 1) % count);
        else if (key.return) chooseFromList();
    };
    const handleTextKey = (
        input: string,
        key: Key,
        text: { kind: 'manual' | 'clone'; value: string },
    ) => {
        if (key.escape) {
            setMessage(undefined);
            setStep({ kind: 'list' });
        } else if (key.return) {
            if (!text.value.trim()) return;
            if (text.kind === 'manual')
                submitManualProject(text.value, choose, setMessage);
            else clone(text.value);
        } else {
            const value = editText(text.value, input, key);
            if (value !== undefined) setStep({ ...text, value });
        }
    };
    useInput((input, key) => {
        if (busy) return;
        if (step.kind === 'list') return handleListKey(input, key);
        if (step.kind === 'confirm') {
            if (key.escape) setStep({ kind: 'manual', value: step.directory });
            else if (key.return) choose(step.directory, false);
            return;
        }
        if (step.kind === 'cloning') return;
        handleTextKey(input, key, step);
    });
}

function Status({ message }: { message: Notice | undefined }) {
    return (
        <>
            {message && (
                <Text
                    color={message.error ? theme.error : theme.muted}
                    wrap="wrap"
                >
                    {clean(message.text)}
                </Text>
            )}
        </>
    );
}

function candidateLabels(
    candidates: Candidate[],
    current: string | undefined,
): string[] {
    return [
        ...candidates.map((candidate) => {
            const marker = candidate.directory === current ? '(•)' : '( )';
            const validity =
                candidate.valid === undefined
                    ? ''
                    : candidate.valid
                      ? ''
                      : '  [Invalid]';
            return `${marker} ${displayPath(candidate.directory)}${candidate.directory === current ? '  current' : ''}${validity}`;
        }),
        ...actions,
    ];
}

function stepPrompt(step: Step) {
    return step.kind === 'manual'
        ? 'Enter the path of an existing docker-chs-development checkout.'
        : step.kind === 'clone'
          ? 'Enter a new directory to clone docker-chs-development into. The terminal is handed to git so SSH prompts are visible.'
          : step.kind === 'confirm'
            ? `This checkout's origin is ${step.origin ? clean(step.origin) : 'not set'}, not companieshouse/docker-chs-development. Use it anyway?`
            : step.kind === 'cloning'
              ? `Cloning into ${displayPath(step.directory)}…`
              : '';
}

function StepView({
    step,
    busy,
    message,
}: {
    step: Step;
    busy: boolean;
    message: Notice | undefined;
}) {
    const prompt = stepPrompt(step);
    return (
        <ModalFrame title="Choose docker-chs-development project">
            <Text color={theme.muted} wrap="wrap">
                {prompt}
            </Text>
            {(step.kind === 'manual' || step.kind === 'clone') && (
                <Box marginY={1}>
                    <Text color={theme.foreground} wrap="truncate-start">
                        Path: {step.value}
                        <Text color={theme.accent}>▌</Text>
                    </Text>
                </Box>
            )}
            {step.kind === 'confirm' && (
                <Box marginY={1}>
                    <Text color={theme.foreground} wrap="truncate-middle">
                        {displayPath(step.directory)}
                    </Text>
                </Box>
            )}
            <Status message={message} />
            <KeyboardHints>
                {busy
                    ? 'Checking…'
                    : step.kind === 'confirm'
                      ? 'Enter use this project · Esc back'
                      : step.kind === 'cloning'
                        ? 'Waiting for git…'
                        : 'Type · Enter continue · Ctrl+U clear · Esc back'}
            </KeyboardHints>
        </ModalFrame>
    );
}

function ListView({
    current,
    candidates,
    searching,
    visited,
    truncated,
    labels,
    start,
    height,
    index,
    message,
    busy,
}: {
    current: string | undefined;
    candidates: Candidate[];
    searching: boolean;
    visited: number;
    truncated: boolean;
    labels: string[];
    start: number;
    height: number;
    index: number;
    message: Notice | undefined;
    busy: boolean;
}) {
    const selectedCandidate = candidates[index];
    return (
        <ModalFrame title="Choose docker-chs-development project">
            {searching ? (
                <Spinner
                    label={`Searching your home directory… ${visited.toLocaleString()} directories checked`}
                />
            ) : (
                <Text color={theme.muted} wrap="truncate-end">
                    {candidates.length
                        ? `Found ${candidates.length} clone${candidates.length === 1 ? '' : 's'} in ${visited.toLocaleString()} directories.`
                        : 'No clones found under your home directory.'}
                    {truncated ? ' Search limit reached.' : ''}
                </Text>
            )}
            <Box flexDirection="column" marginY={1} flexShrink={1}>
                {labels.slice(start, start + height).map((label, offset) => (
                    <SelectableRow
                        key={`${start + offset}:${label}`}
                        selected={start + offset === index}
                    >
                        {label}
                    </SelectableRow>
                ))}
            </Box>
            {selectedCandidate?.valid === false &&
                selectedCandidate.message && (
                    <Text color={theme.development} wrap="truncate-end">
                        {clean(selectedCandidate.message)}
                    </Text>
                )}
            <Text color={theme.muted}>
                Selecting a checkout stops the current environment and keeps its
                data volumes.
            </Text>
            <Status message={message} />
            <KeyboardHints>
                {busy ? 'Checking…' : '↑ ↓ choose · Enter select · Esc cancel'}
            </KeyboardHints>
        </ModalFrame>
    );
}

export default function ProjectPickerModal({
    current,
    onSelect,
    onClone,
    onClose,
}: ProjectPickerModalProps) {
    const { rows } = useWindowSize();
    const client = useClient();
    const session = useSession();
    const { search, candidates, searching, visited, truncated, setCandidates } =
        useProjectSearch(client, session);
    const [selected, setSelected] = useState(0);
    const [step, setStep] = useState<Step>({ kind: 'list' });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<Notice>();
    const { choose, clone } = useProjectActions({
        client,
        search,
        setBusy,
        setMessage,
        setStep,
        addCandidate: (directory) =>
            setCandidates((list) => [...list, { directory }]),
        onSelect,
        onClone,
        onClose,
    });
    const count = candidates.length + actions.length;
    const index = Math.min(selected, count - 1);
    usePickerInput({
        busy,
        step,
        index,
        count,
        candidates,
        client,
        choose,
        clone,
        setStep,
        setSelected,
        setMessage,
        search,
        onClose,
    });
    if (step.kind !== 'list')
        return <StepView step={step} busy={busy} message={message} />;
    const height = modalListHeight(rows, message ? 11 : 9);
    const start = centeredStart(index, height, count);
    return (
        <ListView
            current={current}
            candidates={candidates}
            searching={searching}
            visited={visited}
            truncated={truncated}
            labels={candidateLabels(candidates, current)}
            start={start}
            height={height}
            index={index}
            message={message}
            busy={busy}
        />
    );
}
