import { Box, Text, useInput, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';
import { useOptionalClient } from '../context.js';
import { usePollingEffect } from '../hooks/use-polling-effect.js';
import type { ProxyState } from '../../domain/environment.js';
import type { ServiceGroup } from '../../domain/services.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import type { ReactNode } from 'react';
import type { Key } from 'ink';
import type { EnvironmentClient } from '../../client/environment.js';
import type { LiveState } from '../../domain/live.js';
import type { EnvironmentSummary } from '../../domain/environment.js';
import {
    environmentActions,
    environmentDetailList,
    blockerRows,
    environmentDetails,
    environmentOutput,
    environmentStatus,
    environmentSteps,
    wrapText,
    type EnvironmentActionId,
    type EnvironmentActionItem,
    type EnvironmentStatus,
    type EnvironmentTone,
} from '../models/environment.js';
import SelectableRow from './selectable-row.js';
import KeyboardHints from './keyboard-hints.js';
import { theme } from './theme.js';
import { useSpinner } from '../hooks/use-spinner.js';
import EnvironmentProfilesModal from './environment-profiles-modal.js';
import VersionSourceModal from './version-source-modal.js';
import ConfirmModal from './confirm-modal.js';

export const toneColors: Record<EnvironmentTone, string | undefined> = {
    healthy: theme.healthy,
    busy: theme.development,
    warning: theme.development,
    error: theme.error,
    muted: theme.muted,
};

interface Row {
    text: string;
    color: string | undefined;
    bold?: boolean;
}

type Wrap = (text: string, color: string | undefined, bold?: boolean) => Row[];

interface PanelLayout {
    modalWidth: number;
    paddingX: number;
    paddingY: number;
    contentWidth: number;
    showHints: boolean;
    frameHeight: number;
    gap: number;
    fixedHeight: number;
    detailRoom: number;
}

interface EnvironmentPanelProps {
    controller?: EnvironmentClient;
    state: LiveState;
    summary?: EnvironmentSummary;
    statuses?: Record<string, ServiceStatus>;
    groups?: ServiceGroup[];
    onClose(): void;
    onSetupSsh(): void;
    onLogin(kind: 'aws' | 'registry'): void;
    onViewLogs(problems: boolean): void;
    onAutoApply(value: boolean): void | Promise<void>;
    onProfiles?(): void;
    onVersions?(): void;
}

interface Notice {
    text: string;
    ok: boolean;
}

/** Proxy counters and lazy/cold-start sets, polled while the panel is open. */
function useProxyState(enabled: boolean): ProxyState | undefined {
    const client = useOptionalClient();
    const [proxy, setProxy] = useState<ProxyState | undefined>();
    const refresh = async (signal: AbortSignal) => {
        if (!client) return;
        try {
            const value = await client.query('proxy.accounting', {}, signal);
            if (!signal.aborted) setProxy(value as ProxyState);
        } catch {
            /* The next poll retries a disconnected daemon. */
        }
    };
    usePollingEffect(enabled, refresh, 2000);
    return proxy;
}

function dependencyMap(groups: ServiceGroup[]) {
    const map: Record<string, string[]> = {};
    for (const group of groups)
        for (const [name, definition] of Object.entries(
            group.definitions ?? {},
        ))
            map[name] = [...definition.dependencies];
    return map;
}

interface DetailInputs {
    state: LiveState;
    summary: EnvironmentSummary | undefined;
    available: boolean;
    notice: Notice | undefined;
    list: string[];
    expanded: boolean;
    wrap: Wrap;
    context: PanelStatusContext;
}

interface PanelStatusContext {
    statuses: Record<string, ServiceStatus>;
    dependencies: Record<string, string[]>;
    proxy: ProxyState | undefined;
}

function computeLayout(
    columns: number,
    rows: number,
    actionCount: number,
): PanelLayout {
    const modalWidth = Math.max(1, Math.min(90, columns));
    const paddingX = columns >= 12 ? 2 : columns >= 8 ? 1 : 0;
    const paddingY = rows >= 14 ? 1 : 0;
    const contentWidth = Math.max(1, modalWidth - 2 - paddingX * 2);
    const showHints = rows >= 9;
    const frameHeight = 2 + paddingY * 2;
    const gap = rows >= 16 ? 1 : 0;
    const fixedHeight = 1 + gap + actionCount + (showHints ? 1 : 0);
    const detailRoom = Math.max(1, rows - frameHeight - fixedHeight);
    return {
        modalWidth,
        paddingX,
        paddingY,
        contentWidth,
        showHints,
        frameHeight,
        gap,
        fixedHeight,
        detailRoom,
    };
}

function makeWrapper(contentWidth: number): Wrap {
    return (text, color, bold = false) =>
        wrapText(text, contentWidth).map((line) => ({
            text: line,
            color,
            bold,
        }));
}

function busyDetailRows(state: LiveState, wrap: Wrap): Row[] {
    const details: Row[] = [];
    const { steps, current } = environmentSteps(state);
    steps.forEach((step, index) =>
        details.push(
            ...wrap(
                `${index < current ? '✓' : index === current ? '›' : '·'} ${step}`,
                index === current ? theme.foreground : theme.muted,
                index === current,
            ),
        ),
    );
    const output = environmentOutput(state);
    if (output.length) {
        details.push({ text: '', color: theme.muted });
        for (const line of output) details.push(...wrap(line, theme.muted));
    }
    return details;
}

function idleDetailRows(
    state: LiveState,
    summary: EnvironmentSummary | undefined,
    wrap: Wrap,
    context: PanelStatusContext,
): Row[] {
    const details: Row[] = [];
    for (const row of environmentDetails(state, summary))
        details.push(...wrap(row.text, toneColors[row.tone]));
    for (const row of blockerRows(
        state,
        context.statuses,
        context.dependencies,
        context.proxy,
    ))
        details.push(...wrap(row.text, toneColors[row.tone]));
    return details;
}

function buildDetails({
    state,
    summary,
    available,
    notice,
    list,
    expanded,
    wrap,
    context,
}: DetailInputs): Row[] {
    const details: Row[] = [];
    if (!available)
        details.push(
            ...wrap(
                state.message ||
                    'This container engine cannot be controlled from chs-dev.',
                theme.muted,
            ),
        );
    else if (state.busy) details.push(...busyDetailRows(state, wrap));
    else details.push(...idleDetailRows(state, summary, wrap, context));
    if (notice)
        details.push(
            ...wrap(notice.text, notice.ok ? theme.healthy : theme.error),
        );
    if (list.length && !state.busy) {
        if (expanded)
            for (const line of list)
                details.push(...wrap(line, theme.foreground));
        else
            details.push(
                ...wrap('Press d to list service changes.', theme.muted),
            );
    }
    return details;
}

function viewport(details: Row[], detailRoom: number, offset: number) {
    const detailHeight = Math.max(1, Math.min(detailRoom, details.length));
    const maxOffset = Math.max(0, details.length - detailHeight);
    const visibleOffset = Math.min(offset, maxOffset);
    const visible = details.slice(visibleOffset, visibleOffset + detailHeight);
    return { detailHeight, maxOffset, visibleOffset, visible };
}

function statusLine(
    status: EnvironmentStatus,
    busy: boolean,
    spinner: string,
): string {
    const label = busy ? status.label.replace(/(?:…|\.+)$/, '') : status.label;
    return `${busy ? spinner : status.icon} ${label}`;
}

function buildHints(
    hasDetails: boolean,
    scrollable: boolean,
    busy: boolean,
): string {
    return [
        '↑ ↓ choose · Enter select',
        'v versions · p share',
        hasDetails ? 'd details' : '',
        scrollable ? 'PgUp/PgDn scroll' : '',
        busy ? 'x cancel' : '',
        'Esc close',
    ]
        .filter(Boolean)
        .join(' · ');
}

function panelActions(
    props: EnvironmentPanelProps,
    clearSelection: () => void,
    reset: () => void,
    notify: (notice: Notice) => void,
) {
    const { controller, state } = props;
    const apply = () => {
        clearSelection();
        void controller?.apply();
    };
    const handlers: Record<EnvironmentActionId, () => void> = {
        start: () => {
            reset();
            clearSelection();
            void controller?.start();
        },
        confirm: () => {
            controller?.confirmStart();
            clearSelection();
        },
        dismiss: () => {
            controller?.dismissPlan();
            clearSelection();
        },
        apply,
        retry: apply,
        'restart-failing': () => {
            void controller
                ?.serviceAction(props.summary?.failed ?? [], 'restart')
                .then(
                    (result) => notify({ text: result.message, ok: result.ok }),
                    (error) =>
                        notify({
                            text:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            ok: false,
                        }),
                );
        },
        stop: () => {
            clearSelection();
            void controller?.stop();
        },
        'auto-apply': () => {
            void Promise.resolve(props.onAutoApply(!state.autoApply)).then(
                () =>
                    notify({
                        text: `Auto-apply ${state.autoApply ? 'disabled' : 'enabled'}.`,
                        ok: true,
                    }),
                (error) =>
                    notify({
                        text:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        ok: false,
                    }),
            );
        },
        'login-aws': () => props.onLogin('aws'),
        'login-registry': () => props.onLogin('registry'),
        ssh: props.onSetupSsh,
        cancel: () => controller?.cancel(),
        logs: () =>
            props.onViewLogs(
                state.phase === 'Failed' || state.phase === 'Blocked',
            ),
        profiles: () => props.onProfiles?.(),
        versions: () => props.onVersions?.(),
        close: props.onClose,
    };
    return handlers;
}

function panelActionList(
    props: EnvironmentPanelProps,
    state: LiveState,
    summary: EnvironmentSummary | undefined,
    controller: EnvironmentClient | undefined,
) {
    const actions = environmentActions(state, summary, !!controller);
    const extras: EnvironmentActionItem[] = [
        ...(props.onVersions
            ? [{ id: 'versions' as const, label: 'Version sources' }]
            : []),
        ...(props.onProfiles
            ? [{ id: 'profiles' as const, label: 'Share environment' }]
            : []),
    ];
    if (!extras.length) return actions;
    const closeIndex = actions.findIndex((action) => action.id === 'close');
    if (closeIndex < 0) return [...actions, ...extras];
    return [
        ...actions.slice(0, closeIndex),
        ...extras,
        ...actions.slice(closeIndex),
    ];
}

function usePanelState(props: EnvironmentPanelProps) {
    const { controller, state } = props;
    const actions = panelActionList(props, state, props.summary, controller);
    const [selectedId, setSelectedId] = useState<
        EnvironmentActionId | undefined
    >(() => actions[0]?.id);
    const [offset, setOffset] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [notice, setNotice] = useState<Notice>();
    const [confirming, setConfirming] = useState<
        EnvironmentActionId | undefined
    >();
    const selectedAvailable = actions.some(
        (action) => action.id === selectedId,
    );
    useEffect(() => {
        if (selectedId && !selectedAvailable) setSelectedId(undefined);
    }, [selectedId, selectedAvailable]);
    const clearSelection = () => setSelectedId(undefined);
    const handlers = panelActions(
        props,
        clearSelection,
        () => setOffset(0),
        setNotice,
    );
    const choice = actions.findIndex((action) => action.id === selectedId);
    return {
        actions,
        choice,
        offset,
        expanded,
        notice,
        run: () => {
            const action = actions[choice];
            if (!action) return;
            setNotice(undefined);
            if (action.id === 'stop' || action.id === 'restart-failing') {
                setConfirming(action.id);
                return;
            }
            if (controller) handlers[action.id]();
            else props.onClose();
        },
        confirming,
        confirm: () => {
            if (!confirming) return;
            handlers[confirming]();
            setConfirming(undefined);
        },
        cancelConfirm: () => setConfirming(undefined),
        move: (backward: boolean) => {
            if (!actions.length) return;
            const index =
                choice < 0
                    ? backward
                        ? actions.length - 1
                        : 0
                    : (choice + (backward ? actions.length - 1 : 1)) %
                      actions.length;
            setSelectedId(actions[index]?.id);
        },
        scroll: (backward: boolean, height: number, maximum: number) =>
            setOffset((value) =>
                Math.max(
                    0,
                    Math.min(
                        maximum,
                        value + (backward ? -1 : 1) * Math.max(1, height - 1),
                    ),
                ),
            ),
        toggleDetails: () => setExpanded((value) => !value),
    };
}

function panelKeyKind(input: string, key: Key) {
    const shortcut = (
        {
            q: 'close',
            x: 'cancel',
            d: 'details',
            p: 'profiles',
            v: 'versions',
        } as const
    )[input as 'q' | 'x' | 'd' | 'p' | 'v'];
    if (shortcut) return shortcut;
    if (key.escape) return 'close';
    if (key.pageDown || key.pageUp) return 'scroll';
    if (key.tab) return 'move';
    if (key.upArrow || key.downArrow) return 'move';
    if (key.return) return 'activate';
    return undefined;
}

function StatusHeader({
    title,
    statusText,
    tone,
    room,
}: {
    title: string;
    statusText: string;
    tone: EnvironmentTone;
    room: number;
}) {
    return (
        <Box flexShrink={0} justifyContent="space-between">
            <Text bold color={theme.foreground} wrap="truncate-end">
                {title}
            </Text>
            {room > 3 && (
                <Text color={toneColors[tone]} wrap="truncate-end">
                    {statusText.length > room
                        ? `${statusText.slice(0, room - 1)}…`
                        : statusText}
                </Text>
            )}
        </Box>
    );
}

function DetailLines({
    rows,
    offset,
    height,
}: {
    rows: Row[];
    offset: number;
    height: number;
}) {
    return (
        <Box
            flexDirection="column"
            height={height}
            overflow="hidden"
            flexShrink={0}
        >
            {rows.map((row, index) => (
                <Text
                    key={`${offset}-${index}`}
                    color={row.color}
                    bold={row.bold}
                    wrap="truncate-end"
                >
                    {row.text || ' '}
                </Text>
            ))}
        </Box>
    );
}

function ActionRows({
    actions,
    choice,
    marginTop,
}: {
    actions: EnvironmentActionItem[];
    choice: number;
    marginTop: number;
}) {
    return (
        <Box flexDirection="column" flexShrink={0} marginTop={marginTop}>
            {actions.map((action, index) => (
                <SelectableRow key={action.id} selected={choice === index}>
                    {action.label}
                </SelectableRow>
            ))}
        </Box>
    );
}

function PanelModal({
    columns,
    rows,
    layout,
    error,
    detailHeight,
    children,
}: {
    columns: number;
    rows: number;
    layout: PanelLayout;
    error: boolean;
    detailHeight: number;
    children: ReactNode;
}) {
    return (
        <Box
            position="absolute"
            width={columns}
            height={rows}
            alignItems="center"
            justifyContent="center"
        >
            <Box
                width={layout.modalWidth}
                height={Math.max(
                    1,
                    Math.min(
                        rows,
                        layout.frameHeight + layout.fixedHeight + detailHeight,
                    ),
                )}
                flexDirection="column"
                borderStyle="round"
                borderColor={error ? theme.error : theme.accent}
                backgroundColor={theme.background}
                paddingX={layout.paddingX}
                paddingY={layout.paddingY}
                overflow="hidden"
            >
                {children}
            </Box>
        </Box>
    );
}

function EnvironmentConfirmation({
    action,
    onConfirm,
    onCancel,
}: {
    action: EnvironmentActionId;
    onConfirm(): void;
    onCancel(): void;
}) {
    const stopping = action === 'stop';
    return (
        <ConfirmModal
            title={stopping ? 'Stop environment' : 'Restart failing services'}
            message={
                stopping
                    ? 'Stop all services in this environment?'
                    : 'Restart the failing services now?'
            }
            confirmLabel={stopping ? 'Stop environment' : 'Restart services'}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}

function useEnvironmentPanelInput(
    props: EnvironmentPanelProps,
    panel: ReturnType<typeof usePanelState>,
    detailHeight: number,
    maxOffset: number,
) {
    const { controller, state, onClose } = props;
    const { actions, run, move, scroll, toggleDetails } = panel;
    const keyActions: Record<
        Exclude<ReturnType<typeof panelKeyKind>, undefined>,
        (key: Key) => void
    > = {
        close: onClose,
        profiles: () => props.onProfiles?.(),
        versions: () => props.onVersions?.(),
        cancel: state.busy ? () => controller?.cancel() : () => undefined,
        details: actions.length ? toggleDetails : () => undefined,
        scroll: (key) => scroll(key.pageUp, detailHeight, maxOffset),
        move: (key) => move(key.upArrow || key.shift),
        activate: () => run(),
    };
    useInput(
        (input, key) => {
            const kind = panelKeyKind(input, key);
            if (kind) keyActions[kind](key);
        },
        { isActive: !panel.confirming },
    );
}

export default function EnvironmentPanel(props: EnvironmentPanelProps) {
    const [profilesOpen, setProfilesOpen] = useState(false);
    const [versionsOpen, setVersionsOpen] = useState(false);
    if (versionsOpen)
        return <VersionSourceModal onClose={() => setVersionsOpen(false)} />;
    if (profilesOpen)
        return (
            <EnvironmentProfilesModal onClose={() => setProfilesOpen(false)} />
        );
    return (
        <EnvironmentPanelContent
            {...props}
            onProfiles={() => setProfilesOpen(true)}
            onVersions={() => setVersionsOpen(true)}
        />
    );
}

function EnvironmentPanelContent(props: EnvironmentPanelProps) {
    const { controller, state, summary, onClose } = props;
    const { columns, rows } = useWindowSize();
    const panel = usePanelState(props);
    const { offset, expanded, notice, actions, choice } = panel;
    const available = !!controller;
    const proxy = useProxyState(available);
    const status = environmentStatus(state, summary, available);
    const busy = status.tone === 'busy';
    const spinner = useSpinner(busy);
    const list = environmentDetailList(state);
    const layout = computeLayout(columns, rows, actions.length);
    const wrap = makeWrapper(layout.contentWidth);
    const details = buildDetails({
        state,
        summary,
        available,
        notice,
        list,
        expanded,
        wrap,
        context: {
            statuses: props.statuses ?? {},
            dependencies: dependencyMap(props.groups ?? []),
            proxy,
        },
    });
    const { detailHeight, maxOffset, visibleOffset, visible } = viewport(
        details,
        layout.detailRoom,
        offset,
    );
    useEnvironmentPanelInput(props, panel, detailHeight, maxOffset);
    if (panel.confirming)
        return (
            <EnvironmentConfirmation
                action={panel.confirming}
                onConfirm={panel.confirm}
                onCancel={panel.cancelConfirm}
            />
        );
    const statusText = statusLine(status, busy, spinner);
    const room = Math.max(0, layout.contentWidth - 'Environment'.length - 1);
    const hints = buildHints(
        list.length > 0 && !state.busy,
        maxOffset > 0,
        state.busy,
    );
    return (
        <PanelModal
            columns={columns}
            rows={rows}
            layout={layout}
            error={status.tone === 'error'}
            detailHeight={detailHeight}
        >
            <StatusHeader
                title="Environment"
                statusText={statusText}
                tone={status.tone}
                room={room}
            />
            <DetailLines
                rows={visible}
                offset={visibleOffset}
                height={detailHeight}
            />
            <ActionRows
                actions={actions}
                choice={choice}
                marginTop={layout.gap}
            />
            {layout.showHints && <KeyboardHints>{hints}</KeyboardHints>}
        </PanelModal>
    );
}
