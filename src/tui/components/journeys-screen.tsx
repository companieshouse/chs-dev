import { useClient } from '../context.js';
import { usePollingEffect } from '../hooks/use-polling-effect.js';
import { useModalSave } from '../hooks/use-modal-save.js';
import { useSearch } from '../hooks/use-search.js';
import { ChoiceModal } from './settings-modals.js';
import {
    journeyDraft,
    journeyDraftProblem,
    moveJourneyCursor,
    renameJourney,
    type JourneyCreatorState,
} from '../models/journey-creator.js';
import {
    applyMemberState,
    deriveJourneySets,
    journeyDirty,
    journeyEditorState,
    journeyEditorView,
    journeyGroupLabel,
    journeyGroups,
    journeyListRows,
    visibleMembers,
    type JourneyEditorView,
    type JourneyGrouping,
    type JourneyListInput,
    type JourneyListRow,
} from '../models/journeys-tab.js';
import { editText } from './text-input.js';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import SearchHeader from './search-header.js';
import TabScreen from './tab-screen.js';
import ConfirmModal from './confirm-modal.js';
import { modalListHeight } from './modal-frame.js';
import { footerBindingsForTab } from '../models/keymap.js';
import { centeredStart } from '../models/modules.js';
import { plural } from '../models/formatting.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { Key } from 'ink';
import { useMemo, useState } from 'react';
import type { Client } from '../../client/client.js';
import type { StackMeasurement } from '../../domain/measurements.js';
import type { ServiceDetails, ServiceGroup } from '../../domain/services.js';
import type { SessionUsage } from '../../protocol/types.js';

const journeyNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

const emptyList: JourneyListInput = { journeys: [], invalid: [] };

type Mode =
    | { kind: 'list' }
    | { kind: 'edit'; state: JourneyCreatorState; isNew: boolean }
    | {
          kind: 'switch';
          journey: NonNullable<StackMeasurement['journey']>;
      }
    | { kind: 'delete'; name: string }
    | { kind: 'clear' };

interface Notice {
    text: string;
    ok: boolean;
}

interface EditorContext {
    definitions: string[];
    dependencies: Record<string, readonly string[]>;
    lazyDefault: ReadonlySet<string>;
    learned: ReadonlySet<string>;
    unusedLastRun: ReadonlySet<string>;
}

export default function JourneysScreen({
    active,
    height,
    groups,
    usage,
}: {
    active: boolean;
    height: number;
    groups: ServiceGroup[];
    usage: SessionUsage;
}) {
    const client = useClient();
    const editor = useEditorContext(groups, usage);
    const { list, refresh } = useJourneyList(client, active);
    const [mode, setMode] = useState<Mode>({ kind: 'list' });
    const [selected, setSelected] = useState(0);
    const [notice, setNotice] = useState<Notice>();
    const [busy, setBusy] = useState(false);
    const backTo = (text?: string, ok = true) => {
        setMode({ kind: 'list' });
        refresh();
        if (text) setNotice({ text, ok });
    };

    const rows = useMemo(
        () =>
            journeyListRows(list ?? emptyList, {
                dependencies: editor.dependencies,
                lazyDefault: editor.lazyDefault,
                learned: editor.learned,
            }),
        [list, editor],
    );
    const openEditor = (row: JourneyListRow) =>
        setMode(
            editMode(editor, row.name, {
                services: row.services,
                lazy: row.lazy,
                excluded: row.excluded,
            }),
        );
    const openNew = () => setMode(editMode(editor, '', undefined));
    const beginSwitch = (name: string) =>
        beginJourneySwitch(client, name, { setMode, setNotice, setBusy });

    return renderMode(mode, {
        client,
        editor,
        active,
        height,
        backTo,
        setMode,
        rows,
        selected,
        setSelected,
        activeName: list?.active,
        busy,
        notice,
        onSwitch: beginSwitch,
        onDelete: (name) => setMode({ kind: 'delete', name }),
        onClearCache: () => setMode({ kind: 'clear' }),
    });
}

interface ViewProps {
    client: Client;
    editor: EditorContext;
    active: boolean;
    height: number;
    backTo(text?: string, ok?: boolean): void;
    setMode(mode: Mode): void;
    rows: JourneyListRow[];
    selected: number;
    setSelected(index: number): void;
    activeName: string | undefined;
    busy: boolean;
    notice: Notice | undefined;
    onSwitch(name: string): void;
    onDelete(name: string): void;
    onClearCache(): void;
}

function editMode(
    context: EditorContext,
    name: string,
    initial:
        | {
              services?: readonly string[];
              lazy?: readonly string[];
              excluded?: readonly string[];
          }
        | undefined,
): Mode {
    return {
        kind: 'edit',
        isNew: !name,
        state: journeyEditorState({
            name,
            members: context.definitions,
            initial,
            dependencies: context.dependencies,
            lazyDefault: context.lazyDefault,
            learned: context.learned,
            unusedLastRun: context.unusedLastRun,
        }),
    };
}

function renderMode(mode: Mode, view: ViewProps): React.ReactNode {
    const { client, editor, height, backTo } = view;
    if (mode.kind === 'edit')
        return (
            <Editor
                initial={mode.state}
                isNew={mode.isNew}
                active={view.active}
                context={editor}
                client={client}
                height={height}
                onSaved={() =>
                    backTo(`Saved journey ${mode.state.name}.`, true)
                }
                onClose={() => backTo()}
            />
        );
    if (mode.kind === 'switch')
        return (
            <SwitchPreview
                journey={mode.journey}
                client={client}
                active={view.active}
                height={height}
                onDone={backTo}
            />
        );
    if (mode.kind === 'delete')
        return (
            <DeleteConfirm
                name={mode.name}
                client={client}
                active={view.active}
                onDone={(text) => backTo(text, true)}
                onClose={() => backTo()}
            />
        );
    if (mode.kind === 'clear')
        return (
            <ClearConfirm
                client={client}
                active={view.active}
                onDone={(text) => backTo(text, true)}
                onClose={() => backTo()}
            />
        );
    return (
        <ListView
            rows={view.rows}
            active={view.active}
            selected={view.selected}
            onSelect={view.setSelected}
            activeName={view.activeName}
            busy={view.busy}
            notice={view.notice}
            height={view.height}
            onClearCache={view.onClearCache}
            onEdit={(row) =>
                view.setMode(
                    editMode(view.editor, row.name, {
                        services: row.services,
                        lazy: row.lazy,
                        excluded: row.excluded,
                    }),
                )
            }
            onNew={() => view.setMode(editMode(view.editor, '', undefined))}
            onSwitch={view.onSwitch}
            onDelete={view.onDelete}
        />
    );
}

function useEditorContext(
    groups: ServiceGroup[],
    usage: SessionUsage,
): EditorContext {
    return useMemo(() => editorContext(groups, usage), [groups, usage]);
}

function editorContext(
    groups: ServiceGroup[],
    usage: SessionUsage,
): EditorContext {
    const definitions: string[] = [];
    for (const group of groups) definitions.push(...editableNames(group));
    const dependencies: Record<string, readonly string[]> = {};
    const lazyDefault = new Set<string>();
    for (const group of groups)
        for (const [name, definition] of Object.entries(
            group.definitions ?? {},
        )) {
            dependencies[name] = [...definition.dependencies];
            if (definition.startMode === 'lazy') lazyDefault.add(name);
        }
    return {
        definitions: definitions.sort((a, b) => a.localeCompare(b)),
        dependencies,
        lazyDefault,
        learned: new Set(usage.learned),
        unusedLastRun: new Set(usage.unusedLastRun),
    };
}

function editableNames(group: ServiceGroup): string[] {
    return Object.entries(group.definitions ?? {})
        .filter(([, definition]) => !definition.base && !definition.deprecated)
        .map(([name]) => name);
}

function useJourneyList(client: Client, active: boolean) {
    const [list, setList] = useState<JourneyListInput>();
    const [revision, setRevision] = useState(0);
    const refresh = () => setRevision((current) => current + 1);
    usePollingEffect(
        active,
        async (signal) => {
            try {
                const value = await client.query('journey.list', {}, signal);
                if (!signal.aborted) setList(value as JourneyListInput);
            } catch {
                /* Older daemons and disconnects retry on the next poll. */
            }
        },
        2000,
        revision,
    );
    return { list, refresh };
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

interface ListKeys {
    rows: JourneyListRow[];
    selected: number;
    onSelect(index: number): void;
    onEdit(row: JourneyListRow): void;
    onNew(): void;
    onSwitch(name: string): void;
    onDelete(name: string): void;
    onClearCache(): void;
}

function listKey(input: string, key: Key, keys: ListKeys): void {
    if (key.upArrow || key.downArrow) return moveListSelection(key, keys);
    if (input === 'c') return keys.onClearCache();
    const row = keys.rows[keys.selected];
    if (!row) return;
    if (row.invalid) return invalidListKey(input, row, keys);
    if (key.return) return keys.onEdit(row);
    if (input === 's') return keys.onSwitch(row.name);
    if (input === 'd') return keys.onDelete(row.name);
    if (input === 'n') return keys.onNew();
}

function moveListSelection(key: Key, keys: ListKeys): void {
    const offset = key.upArrow ? -1 : 1;
    keys.onSelect(
        Math.max(0, Math.min(keys.rows.length - 1, keys.selected + offset)),
    );
}

function invalidListKey(
    input: string,
    row: JourneyListRow,
    keys: ListKeys,
): void {
    if (input === 'd') keys.onDelete(row.name);
}

function ListView({
    active,
    rows,
    selected,
    onSelect,
    activeName,
    busy,
    notice,
    height,
    onClearCache,
    onEdit,
    onNew,
    onSwitch,
    onDelete,
}: {
    active: boolean;
    rows: JourneyListRow[];
    selected: number;
    onSelect(index: number): void;
    activeName: string | undefined;
    busy: boolean;
    notice: Notice | undefined;
    height: number;
    onClearCache(): void;
    onEdit(row: JourneyListRow): void;
    onNew(): void;
    onSwitch(name: string): void;
    onDelete(name: string): void;
}) {
    useInput(
        (input, key) =>
            listKey(input, key, {
                rows,
                selected,
                onSelect,
                onEdit,
                onNew,
                onSwitch,
                onDelete,
                onClearCache,
            }),
        { isActive: active && !busy },
    );
    return (
        <TabScreen
            height={height}
            footer={
                <KeyboardHints bindings={footerBindingsForTab('Journeys')} />
            }
        >
            <Text color={theme.muted} wrap="truncate-end">
                {plural(rows.length, 'journey')}
                {activeName
                    ? ` · active: ${activeName}`
                    : ' · no journey selected'}
                {busy ? ' · working…' : ''}
            </Text>
            {notice && (
                <Text
                    color={notice.ok ? theme.healthy : theme.error}
                    wrap="truncate-end"
                >
                    {notice.text}
                </Text>
            )}
            {rows.length === 0 && (
                <Text color={theme.foreground}>
                    No journeys yet. Press n to create one.
                </Text>
            )}
            <JourneyRows rows={rows} selected={selected} height={height - 5} />
        </TabScreen>
    );
}

function JourneyRows({
    rows,
    selected,
    height,
}: {
    rows: JourneyListRow[];
    selected: number;
    height: number;
}) {
    const room = Math.max(1, height);
    const start = centeredStart(selected, room, rows.length);
    return (
        <Box flexDirection="column" flexShrink={1}>
            {rows.slice(start, start + room).map((row, offset) => (
                <JourneyRowLine
                    key={`${row.name}:${start + offset}`}
                    row={row}
                    selected={start + offset === selected}
                />
            ))}
        </Box>
    );
}

function journeyRowLabel(row: JourneyListRow): string {
    if (row.invalid) return `${row.name} - invalid: ${row.invalid}`;
    const start = row.derived?.start ?? row.services.length;
    const lazy = row.derived?.lazy ?? row.lazy.length;
    return `${row.name} - ${start} always start, ${lazy} lazy`;
}

function JourneyRowLine({
    row,
    selected,
}: {
    row: JourneyListRow;
    selected: boolean;
}) {
    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Text
                wrap="truncate-end"
                bold={selected}
                color={
                    selected
                        ? theme.selectionText
                        : row.invalid
                          ? theme.error
                          : theme.foreground
                }
            >
                <Text bold color={theme.accent}>
                    {selected ? '›' : ' '}
                </Text>{' '}
                {journeyRowLabel(row)}
                {row.active && <Text color={theme.healthy}> (active)</Text>}
            </Text>
        </Box>
    );
}

function memberLabel(state: string) {
    return state === 'start'
        ? 'always start'
        : state === 'lazy'
          ? 'lazy'
          : 'not included';
}

function memberGlyph(state: string) {
    return state === 'out' ? '○' : '●';
}

function countsLine(state: JourneyCreatorState) {
    const sets = deriveJourneySets({
        services: state.services,
        lazy: state.lazy,
        excluded: state.excluded,
        dependencies: state.dependencies,
        lazyDefault: state.lazyDefault,
        learned: state.learned,
    });
    const out = state.members.length - sets.started.length - sets.lazy.length;
    return `${sets.started.length} always start · ${sets.lazy.length} lazy · ${out} not included`;
}

function SelectedRow({
    selected,
    children,
}: {
    selected: boolean;
    children: React.ReactNode;
}) {
    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Text
                wrap="truncate-end"
                bold={selected}
                color={selected ? theme.selectionText : theme.foreground}
            >
                <Text bold color={theme.accent}>
                    {selected ? '›' : ' '}
                </Text>{' '}
                {children}
            </Text>
        </Box>
    );
}

function ModeChoiceModal({
    active,
    member,
    current,
    onChoose,
    onClose,
}: {
    active: boolean;
    member: string;
    current: string;
    onChoose(value: string): void;
    onClose(): void;
}) {
    return (
        <ChoiceModal
            title={`Mode for ${member}`}
            active={active}
            choices={[
                { value: 'start', label: 'always start' },
                { value: 'lazy', label: 'lazy' },
                { value: 'out', label: 'not included' },
            ]}
            current={current}
            onChoose={async (value) => onChoose(value ?? 'out')}
            onClose={onClose}
        />
    );
}

function SavePromptModal({
    active,
    name,
    onConfirm,
    onCancel,
}: {
    active: boolean;
    name: string;
    onConfirm(): void;
    onCancel(): void;
}) {
    return (
        <ConfirmModal
            title="Save changes?"
            message={`Save changes to journeys/${name}.yaml?`}
            confirmLabel="Save"
            cancelLabel="Discard"
            defaultOption="confirm"
            active={active}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}

function EditorBody({
    state,
    isNew,
    context,
    view,
    visible,
    search,
    save,
    indexValue,
    capacity,
    start,
    height,
}: {
    state: JourneyCreatorState;
    isNew: boolean;
    context: EditorContext;
    view: JourneyEditorView;
    visible: string[];
    search: ReturnType<typeof useSearch>;
    save: ReturnType<typeof useModalSave>;
    indexValue: number;
    capacity: number;
    start: number;
    height: number;
}) {
    return (
        <TabScreen
            height={height}
            footer={
                <KeyboardHints>{editorHint(save.busy, search)}</KeyboardHints>
            }
        >
            <Text color={theme.muted} wrap="wrap">
                {isNew
                    ? 'New journey - type a name, then choose services.'
                    : `Editing journeys/${state.name}.yaml - base infrastructure always starts and is not listed.`}
            </Text>
            <Box marginY={1}>
                <SelectedRow selected={indexValue === 0}>
                    {state.name || ' '}
                    <Text color={theme.accent}>
                        {indexValue === 0 ? '▌' : ''}
                    </Text>
                </SelectedRow>
            </Box>
            {search.searching || search.query ? (
                <SearchHeader
                    searching={search.searching}
                    query={search.query}
                    hint="/ to filter services"
                />
            ) : (
                <Text color={theme.muted} wrap="truncate-end">
                    {countsLine(state)}
                </Text>
            )}
            <EditorRows
                visible={visible}
                grouping={view.grouping}
                states={state.states}
                context={context}
                view={view}
                capacity={capacity}
                start={start}
                indexValue={indexValue}
            />
            {save.error && (
                <Text color={theme.error} wrap="wrap">
                    {save.error}
                </Text>
            )}
        </TabScreen>
    );
}

function editorHint(
    busy: boolean,
    search: ReturnType<typeof useSearch>,
): string {
    if (busy) return 'Saving…';
    if (search.searching) return 'Type to filter · Enter finish · Esc clear';
    return '↑ ↓ select · Enter choose mode · / search · Esc back';
}

function useJourneyEditor({
    initial,
    active,
    context,
    client,
    onSaved,
    onClose,
}: {
    initial: JourneyCreatorState;
    active: boolean;
    context: EditorContext;
    client: Client;
    onSaved: () => void;
    onClose: () => void;
}) {
    const [state, setState] = useState(initial);
    const [original] = useState(initial);
    const search = useSearch();
    const view = useMemo(() => journeyEditorView(state), [state]);
    const visible = useMemo(
        () => visibleMembers(state.members, view.grouping, search.query),
        [state.members, view.grouping, search.query],
    );
    const dirty = useMemo(
        () => journeyDirty(state, original),
        [state, original],
    );
    const save = useModalSave(async () => {
        const problem = journeyDraftProblem(state, journeyNamePattern);
        if (problem) throw new Error(problem);
        const draft = journeyDraft(state);
        await client.command('project.saveJourney', {
            name: draft.name,
            services: draft.services,
            lazy: draft.lazy,
            excluded: draft.excluded,
        });
    }, onSaved);
    const [savePrompt, setSavePrompt] = useState(false);
    const [modeChoice, setModeChoice] = useState<string>();
    const indexValue = selectedIndex(state);
    const selectedMember = visible[indexValue - 1];
    const closeOrPrompt = () => {
        if (dirty) setSavePrompt(true);
        else onClose();
    };
    const keys = editorInputKeys({
        state,
        setState,
        search,
        visibleCount: visible.length,
        busy: save.busy,
        naming: indexValue === 0,
        closeOrPrompt,
        choose: () => {
            if (selectedMember) setModeChoice(selectedMember);
        },
    });
    useInput((input, editKey) => editorKey(input, editKey, keys), {
        isActive: active && !save.busy && !modeChoice && !savePrompt,
    });
    return {
        state,
        setState,
        search,
        view,
        visible,
        save,
        savePrompt,
        setSavePrompt,
        modeChoice,
        setModeChoice,
        indexValue,
    };
}

function Editor({
    initial,
    isNew,
    active,
    context,
    client,
    height,
    onSaved,
    onClose,
}: {
    initial: JourneyCreatorState;
    isNew: boolean;
    active: boolean;
    context: EditorContext;
    client: Client;
    height: number;
    onSaved(): void;
    onClose(): void;
}) {
    const terminalRows = useWindowSize().rows;
    const editor = useJourneyEditor({
        initial,
        active,
        context,
        client,
        onSaved,
        onClose,
    });
    return renderEditorContent({
        editor,
        isNew,
        active,
        context,
        height,
        terminalRows,
    });
}

function renderEditorContent({
    editor,
    isNew,
    active,
    context,
    height,
    terminalRows,
}: {
    editor: ReturnType<typeof useJourneyEditor>;
    isNew: boolean;
    active: boolean;
    context: EditorContext;
    height: number;
    terminalRows: number;
}) {
    const {
        state,
        setState,
        search,
        view,
        visible,
        save,
        savePrompt,
        setSavePrompt,
        modeChoice,
        setModeChoice,
        indexValue,
    } = editor;
    const capacity = Math.max(1, modalListHeight(terminalRows, 10));
    const start = centeredStart(indexValue - 1, capacity, visible.length);
    if (modeChoice)
        return (
            <ModeChoiceModal
                active={active}
                member={modeChoice}
                current={state.states[modeChoice] ?? 'out'}
                onChoose={(value) =>
                    applyModeChoice(state, setState, modeChoice, value)
                }
                onClose={() => setModeChoice(undefined)}
            />
        );
    if (savePrompt)
        return (
            <SavePromptModal
                active={active}
                name={state.name}
                onCancel={() => setSavePrompt(false)}
                onConfirm={() => {
                    setSavePrompt(false);
                    void save.submit();
                }}
            />
        );
    return (
        <EditorBody
            state={state}
            isNew={isNew}
            context={context}
            view={view}
            visible={visible}
            search={search}
            save={save}
            indexValue={indexValue}
            capacity={capacity}
            start={start}
            height={height}
        />
    );
}

function applyModeChoice(
    state: JourneyCreatorState,
    setState: (next: JourneyCreatorState) => void,
    member: string,
    value: string,
): void {
    if (value !== 'start' && value !== 'lazy' && value !== 'out') return;
    setState(applyMemberState(state, member, value));
}

function moveToVisible(
    state: JourneyCreatorState,
    visibleCount: number,
    backward: boolean,
): JourneyCreatorState {
    const selected = Math.max(
        0,
        Math.min(visibleCount, state.selected + (backward ? -1 : 1)),
    );
    return { ...state, selected };
}

interface EditorKeys {
    busy: boolean;
    searching: boolean;
    hasQuery: boolean;
    naming: boolean;
    visibleCount: number;
    beginSearch(): void;
    searchEdit(input: string, key: Key): void;
    searchFinish(): void;
    searchClear(): void;
    closeOrPrompt(): void;
    move(backward: boolean): void;
    moveDownFromName(): void;
    choose(): void;
    rename(input: string, key: Key): void;
}

interface EditorInputArgs {
    state: JourneyCreatorState;
    setState(
        update: (current: JourneyCreatorState) => JourneyCreatorState,
    ): void;
    search: ReturnType<typeof useSearch>;
    visibleCount: number;
    busy: boolean;
    naming: boolean;
    closeOrPrompt(): void;
    choose(): void;
}

function editorInputKeys(args: EditorInputArgs): EditorKeys {
    const { state, setState, search, visibleCount } = args;
    const move = (backward: boolean) =>
        setState((current) => moveToVisible(current, visibleCount, backward));
    return {
        busy: args.busy,
        searching: search.searching,
        hasQuery: search.query.length > 0,
        naming: args.naming,
        visibleCount,
        beginSearch: search.begin,
        searchEdit: (text: string, editKey: Key) => {
            const next = editText(search.query, text, editKey);
            if (next !== undefined) search.setQuery(next);
        },
        searchFinish: search.finish,
        searchClear: search.clear,
        closeOrPrompt: args.closeOrPrompt,
        move,
        moveDownFromName: () => move(false),
        choose: args.choose,
        rename: (text: string, editKey: Key) =>
            setState((current) =>
                renameJourney(current, text, editKey, editText),
            ),
    };
}

function searchKey(input: string, key: Key, keys: EditorKeys): void {
    if (key.return) return keys.searchFinish();
    if (key.escape) {
        if (keys.hasQuery) return keys.searchClear();
        keys.searchFinish();
        return keys.closeOrPrompt();
    }
    return keys.searchEdit(input, key);
}

function editorKey(input: string, key: Key, keys: EditorKeys): void {
    if (keys.busy) return;
    if (keys.searching) return searchKey(input, key, keys);
    if (key.escape) return keys.closeOrPrompt();
    if (input === '/') return keys.beginSearch();
    if (key.upArrow || key.downArrow) return keys.move(key.upArrow);
    if (key.return) {
        if (keys.naming) return keys.moveDownFromName();
        return keys.choose();
    }
    if (keys.naming) return keys.rename(input, key);
}

function selectedIndex(state: JourneyCreatorState) {
    return Math.min(state.selected, state.members.length);
}

function memberSuffix(
    member: string,
    context: EditorContext,
    view: JourneyEditorView,
) {
    if (!context.definitions.includes(member)) return ' (unknown service)';
    const parts: string[] = [];
    if (view.excluded.has(member)) parts.push('excluded');
    else {
        if (view.dependencyMembers.has(member)) parts.push('dependency');
        if (view.lazyByDefault.has(member)) parts.push('lazy by default');
        else if (view.learnedLazy.has(member)) parts.push('learned lazy');
        if (view.unusedPinned.has(member)) parts.push('unused last run');
    }
    return parts.length ? ` (${parts.join(' · ')})` : '';
}

function memberColor(states: Record<string, string>, name?: string) {
    const state = states[name ?? ''] ?? 'out';
    if (state === 'out') return theme.disabled;
    if (state === 'lazy') return theme.development;
    return theme.enabled;
}

function MemberText({
    name,
    state,
}: {
    name: string;
    state: 'start' | 'lazy' | 'out';
}) {
    const color =
        state === 'out'
            ? theme.disabled
            : state === 'lazy'
              ? theme.development
              : theme.enabled;
    return (
        <>
            <Text color={color}>{memberGlyph(state)}</Text> {name}
            <Text color={color}>
                {'  '}
                {memberLabel(state)}
            </Text>
        </>
    );
}

function SwitchPreview({
    journey,
    client,
    active,
    height,
    onDone,
}: {
    journey: NonNullable<StackMeasurement['journey']>;
    client: Client;
    active: boolean;
    height: number;
    onDone(text: string, ok: boolean): void;
}) {
    const terminalRows = useWindowSize().rows;
    let outcome = { text: `Switched to journey ${journey.name}.`, ok: true };
    const save = useModalSave(
        async () => {
            const snapshot = await client.query('configuration.snapshot', {});
            await client.command('environment.profileImport', {
                profile: {
                    format: 'chs-dev-environment',
                    version: 1,
                    createdAt: new Date().toISOString(),
                    selections: {
                        ...snapshot.selections,
                        journey: journey.name,
                        services: journey.started,
                    },
                },
                versionsOnly: false,
                revision: snapshot.revision,
            });
            try {
                await client.command('environment.apply', {
                    approveStops: false,
                });
            } catch (error) {
                const code = (error as { detail?: { code?: string } }).detail
                    ?.code;
                if (code !== 'CONFIRMATION_REQUIRED') throw error;
                outcome = {
                    text: 'Switch saved. Approve the stop plan in the Environment panel (Ctrl+E).',
                    ok: true,
                };
            }
        },
        () => onDone(outcome.text, outcome.ok),
    );
    useInput(
        (input, key) => {
            if (save.busy) return;
            if (key.escape) return onDone('Switch cancelled.', true);
            if (key.return) void save.submit();
        },
        { isActive: active },
    );
    const capacity = Math.max(1, modalListHeight(terminalRows, 8));
    return (
        <TabScreen
            height={height}
            footer={
                <KeyboardHints>
                    {save.busy ? 'Applying…' : 'Enter apply · Esc cancel'}
                </KeyboardHints>
            }
        >
            <Text bold color={theme.foreground} wrap="truncate-end">
                Switch to journey {journey.name}
            </Text>
            <PreviewLines journey={journey} capacity={capacity} />
            {save.error && (
                <Text color={theme.error} wrap="wrap">
                    {save.error}
                </Text>
            )}
        </TabScreen>
    );
}

function PreviewLines({
    journey,
    capacity,
}: {
    journey: NonNullable<StackMeasurement['journey']>;
    capacity: number;
}) {
    const lines = [
        {
            text: `${journey.target.serviceCount} selected services (${journey.target.baseServiceCount} base infrastructure), ${journey.target.dependencyEdgeCount} dependency edges.`,
            color: theme.foreground,
        },
        {
            text: `Members started eagerly (${journey.started.length}): ${journey.started.join(', ') || 'none'}`,
            color: theme.enabled,
        },
        {
            text: `Members lazy (${journey.lazy.length}): ${journey.lazy.join(', ') || 'none'}`,
            color: theme.development,
        },
        ...(journey.notInJourney.length
            ? [
                  {
                      text: `Stopped (${journey.notInJourney.length}): ${journey.notInJourney.join(', ')}`,
                      color: theme.error,
                  },
              ]
            : []),
        ...(journey.added.length
            ? [
                  {
                      text: `Added (${journey.added.length}): ${journey.added.join(', ')}`,
                      color: theme.healthy,
                  },
              ]
            : []),
        {
            text: 'Saving switches the selection; apply asks for confirmation when services would stop.',
            color: theme.muted,
        },
    ];
    return (
        <Box flexDirection="column" marginTop={1} flexShrink={1}>
            {lines.slice(0, capacity).map((line) => (
                <Text key={line.text} color={line.color} wrap="truncate-end">
                    {line.text}
                </Text>
            ))}
        </Box>
    );
}

function DeleteConfirm({
    name,
    client,
    active,
    onDone,
    onClose,
}: {
    name: string;
    client: Client;
    active: boolean;
    onDone(text: string): void;
    onClose(): void;
}) {
    return (
        <ConfirmModal
            title={`Delete journey ${name}?`}
            message={`Removes journeys/${name}.yaml; if it is the active journey, the selection is cleared.`}
            confirmLabel="Delete journey"
            active={active}
            onConfirm={async () => {
                const result = await client.command('project.deleteJourney', {
                    name,
                });
                onDone(
                    result.selectionCleared
                        ? `Deleted ${name}; the active journey selection was cleared.`
                        : `Deleted journey ${name}.`,
                );
            }}
            onCancel={onClose}
        />
    );
}

function ClearConfirm({
    client,
    active,
    onDone,
    onClose,
}: {
    client: Client;
    active: boolean;
    onDone(text: string): void;
    onClose(): void;
}) {
    return (
        <ConfirmModal
            title="Clear the usage cache?"
            message="Forgets every learned lazy mode; services return to their configured start modes."
            confirmLabel="Clear cache"
            active={active}
            onConfirm={async () => {
                const { cleared } = await client.command(
                    'usage.cacheClear',
                    {},
                );
                onDone(
                    cleared
                        ? 'Cleared learned usage modes.'
                        : 'No learned usage modes to clear.',
                );
            }}
            onCancel={onClose}
        />
    );
}

function setSwitchMode(
    measurement: StackMeasurement,
    setMode: (mode: Mode) => void,
): void {
    const journey = measurement.journey;
    if (!journey) throw new Error('Journey not measured.');
    setMode({ kind: 'switch', journey });
}

interface SwitchHooks {
    setMode(mode: Mode): void;
    setNotice(notice: Notice | undefined): void;
    setBusy(busy: boolean): void;
}

function beginJourneySwitch(
    client: Client,
    name: string,
    hooks: SwitchHooks,
): void {
    hooks.setBusy(true);
    hooks.setNotice(undefined);
    void client
        .query('environment.measure', { journey: name })
        .then((measurement) =>
            setSwitchMode(measurement as StackMeasurement, hooks.setMode),
        )
        .catch((error: unknown) =>
            hooks.setNotice({ text: errorMessage(error), ok: false }),
        )
        .finally(() => hooks.setBusy(false));
}

interface EditorDisplayRow {
    kind: 'header' | 'member';
    text?: string;
    name?: string;
    position: number;
}

/** Grouped, filtered display rows: headers plus selectable member rows. */
function editorDisplayRows(
    visible: readonly string[],
    grouping: JourneyGrouping,
): EditorDisplayRow[] {
    const rows: EditorDisplayRow[] = [];
    let lastLabel: string | undefined;
    for (const [position, member] of visible.entries()) {
        const label = journeyGroupLabel(member, grouping);
        if (label !== lastLabel) {
            const count = visible.filter(
                (candidate) => journeyGroupLabel(candidate, grouping) === label,
            ).length;
            rows.push({
                kind: 'header',
                text: `${label} (${count})`,
                position,
            });
            lastLabel = label;
        }
        rows.push({ kind: 'member', name: member, position });
    }
    return rows;
}

function EditorRows({
    visible,
    grouping,
    states,
    context,
    view,
    capacity,
    start,
    indexValue,
}: {
    visible: readonly string[];
    grouping: JourneyGrouping;
    states: Record<string, string>;
    context: EditorContext;
    view: JourneyEditorView;
    capacity: number;
    start: number;
    indexValue: number;
}) {
    const display = editorDisplayRows(visible, grouping);
    const firstMember = display.findIndex(
        (row) => row.kind === 'member' && row.position === start,
    );
    let sliceStart = Math.max(0, firstMember);
    // Keep a group header glued to the top of its member window.
    while (sliceStart > 0 && display[sliceStart - 1]!.kind === 'header')
        sliceStart--;
    const windowRows = display.slice(sliceStart, sliceStart + capacity + 2);
    if (!windowRows.length)
        return <Text color={theme.foreground}>No matching services.</Text>;
    return (
        <Box flexDirection="column" flexShrink={1}>
            {windowRows.map((row, offset) =>
                row.kind === 'header' ? (
                    <Text
                        key={`header:${row.text}:${offset}`}
                        bold
                        color={theme.accent}
                        wrap="truncate-end"
                    >
                        {row.text}
                    </Text>
                ) : (
                    <SelectedRow
                        key={row.name}
                        selected={row.position + 1 === indexValue}
                    >
                        <Text color={memberColor(states, row.name)}>
                            {memberGlyph(states[row.name ?? ''] ?? 'out')}
                        </Text>{' '}
                        {row.name}
                        <Text color={memberColor(states, row.name)}>
                            {'  '}
                            {memberLabel(states[row.name ?? ''] ?? 'out')}
                        </Text>
                        <Text color={theme.muted}>
                            {memberSuffix(row.name ?? '', context, view)}
                        </Text>
                    </SelectedRow>
                ),
            )}
        </Box>
    );
}
