import { usePollingEffect } from '../hooks/use-polling-effect.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    ContainerDetails as Details,
    ContainerManager,
    ContainerSummary,
} from '../../domain/containers.js';
import {
    imageVersion,
    isRunningContainer,
    permitsContainerAction,
} from '../../domain/containers.js';
import type { ContainerAction } from '../../domain/live.js';
import { useSpinner } from '../hooks/use-spinner.js';
import {
    useAsyncAction,
    containerActionLabel,
} from '../hooks/use-async-action.js';
import { wrapText } from '../models/environment.js';
import { theme } from './theme.js';
import KeyboardHints from './keyboard-hints.js';
import ServiceLogs from './service-logs.js';
import ScreenHeader from './screen-header.js';

const date = (value?: string) =>
    !value || value.startsWith('0001-') ? '—' : value;

function ownershipLines(details: Details) {
    return [
        `Platform: ${details.platform ?? '—'}`,
        `Image ID: ${details.imageId ?? '—'}`,
        `Service: ${details.service ?? '—'}${details.ownerService && details.ownerService !== details.service ? ` · owner: ${details.ownerService}` : ''}`,
        `Project: ${details.project ?? '—'} · ${details.currentProject ? 'this checkout' : 'outside this checkout'}`,
        `Orchestration: ${details.backend ?? 'unmanaged/unknown'}`,
    ];
}

const identityLines = (details: Details): string[] => [
    `Name: ${details.name}`,
    `ID: ${details.id}`,
    `Status: ${details.status}${details.health ? ` · health: ${details.health}` : ''}`,
    `Image: ${details.image}`,
    `Version/tag: ${imageVersion(details.image)}`,
    ...ownershipLines(details),
    `Created: ${date(details.created)}`,
    `Started: ${date(details.started)}`,
    `Finished: ${date(details.finished)}`,
    `Exit code: ${['exited', 'dead'].includes(details.state) ? (details.exitCode ?? 'unknown') : '—'}`,
];
const overviewLines = (details: Details): string[] => [
    ...identityLines(details),
    '',
    'Ports:',
    ...(details.ports.length ? details.ports.map((p) => `  ${p}`) : ['  None']),
    '',
    'Mounts:',
    ...(details.mounts.length
        ? details.mounts.map(
              (m) =>
                  `  ${m.source} → ${m.target} (${m.type}, ${m.readOnly ? 'read only' : 'read/write'})`,
          )
        : ['  None']),
    '',
    'Networks:',
    ...(details.networks.length
        ? details.networks.map(
              (n) => `  ${n.name}: ${n.addresses.join(', ') || 'no address'}`,
          )
        : ['  None']),
];

const buildLines = (
    details: Details | undefined,
    inspect: boolean,
): string[] =>
    !details
        ? []
        : inspect
          ? [
                'Inspection JSON (environment values and credentials hidden)',
                ...JSON.stringify(details.inspection, null, 2).split('\n'),
            ]
          : overviewLines(details);

type Notice = { ok: boolean; message: string };

function useInspectionPolling({
    manager,
    id,
    revision,
    busy,
    logs,
}: {
    manager: ContainerManager;
    id: string;
    revision: number;
    busy: boolean;
    logs: boolean;
}) {
    const [details, setDetails] = useState<Details>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const loadedId = useRef<string>(undefined);
    useEffect(() => {
        if (loadedId.current === id) return;
        setDetails(undefined);
        setError('');
    }, [id]);
    const refresh = useCallback(
        async (signal: AbortSignal) => {
            setLoading(loadedId.current !== id);
            try {
                const value = await manager.inspect(id, signal);
                if (signal.aborted) return;
                loadedId.current = id;
                setDetails(value);
                setError('');
            } catch (error) {
                if (!signal.aborted)
                    setError(
                        error instanceof Error ? error.message : String(error),
                    );
            } finally {
                if (!signal.aborted) setLoading(false);
            }
        },
        [manager, id],
    );
    usePollingEffect(!busy && !logs, refresh, 5000, revision);
    return { details, error, loading };
}

function refreshLabel(busy: string, loading: boolean, spinner: string) {
    return busy || loading ? `${spinner} ${busy || 'Refreshing'}` : '';
}

function DetailStatus({
    name,
    inspect,
    busy,
    loading,
    spinner,
    running,
    allowed,
    environmentBusy,
    error,
    notice,
}: {
    name: string;
    inspect: boolean;
    busy: string;
    loading: boolean;
    spinner: string;
    running: boolean;
    allowed: boolean;
    environmentBusy: boolean;
    error: string;
    notice: Notice | undefined;
}) {
    return (
        <>
            <Text bold color={theme.accent} wrap="truncate-end">
                {name} · {inspect ? 'Inspect' : 'Container details'}{' '}
                {refreshLabel(busy, loading, spinner)}
            </Text>
            <Text
                color={allowed ? theme.foreground : theme.muted}
                wrap="truncate-end"
            >
                s {running ? 'Stop' : 'Start'} · x Restart · l Logs · i{' '}
                {inspect ? 'Overview' : 'Inspect'} · r Refresh
            </Text>
            {environmentBusy && !busy && (
                <Text color={theme.development} wrap="truncate-end">
                    Environment operation in progress; container actions are
                    unavailable.
                </Text>
            )}
            {error && (
                <Text color={theme.error} wrap="truncate-end">
                    {error.replace(/[\r\n]+/g, ' ')}
                </Text>
            )}
            {notice && (
                <Text
                    color={notice.ok ? theme.healthy : theme.error}
                    wrap="truncate-end"
                >
                    {notice.message.replace(/[\r\n]+/g, ' ')}
                </Text>
            )}
        </>
    );
}

function DetailBody({
    wrapped,
    start,
    height,
}: {
    wrapped: string[];
    start: number;
    height: number;
}) {
    return (
        <Box
            height={height}
            flexShrink={0}
            flexDirection="column"
            overflow="hidden"
        >
            {wrapped.slice(start, start + height).map((line, index) => (
                <Text
                    key={start + index}
                    color={theme.foreground}
                    wrap="truncate-end"
                >
                    {line || ' '}
                </Text>
            ))}
        </Box>
    );
}

type ContainerDetailsProps = {
    id: string;
    manager: ContainerManager;
    environmentBusy: boolean;
    onAction(
        container: ContainerSummary,
        action: ContainerAction,
    ): Promise<{ ok: boolean; message: string }>;
    onClose(): void;
};

function detailViewport(
    columns: number,
    rows: number,
    extraStatusRows: number,
) {
    const paddingX = columns >= 12 ? 1 : 0;
    return {
        paddingX,
        contentWidth: Math.max(1, columns - paddingX * 2),
        height: Math.max(1, rows - 5 - extraStatusRows),
    };
}

function useManagedInspection(
    {
        id,
        manager,
        environmentBusy,
        onAction,
    }: Omit<ContainerDetailsProps, 'onClose'>,
    revision: number,
    logs: boolean,
) {
    const action = useAsyncAction<ContainerAction>();
    const busy = action.busy ? containerActionLabel[action.busy] : '';
    const notice = action.notice;
    const { details, error, loading } = useInspectionPolling({
        manager,
        id,
        revision,
        busy: Boolean(action.busy),
        logs,
    });
    const running = !!details && isRunningContainer(details.state);
    const allowed = Boolean(
        details &&
        !error &&
        !environmentBusy &&
        !busy &&
        permitsContainerAction(details.state),
    );
    const act = (kind: ContainerAction) => {
        if (allowed && details)
            void action.run(kind, () => onAction(details, kind));
    };
    return { details, error, loading, busy, notice, running, allowed, act };
}

function useContainerDetailState({
    id,
    manager,
    environmentBusy,
    onAction,
    onClose,
}: ContainerDetailsProps) {
    const { columns, rows } = useWindowSize();
    const [revision, setRevision] = useState(0);
    const [inspect, setInspect] = useState(false);
    const [logs, setLogs] = useState(false);
    const [offset, setOffset] = useState(0);
    const { details, error, loading, busy, notice, running, allowed, act } =
        useManagedInspection(
            { id, manager, environmentBusy, onAction },
            revision,
            logs,
        );
    const extraStatusRows =
        Number(environmentBusy && !busy) + Number(!!error) + Number(!!notice);
    const { paddingX, contentWidth, height } = detailViewport(
        columns,
        rows,
        extraStatusRows,
    );
    const wrapped = buildLines(details, inspect).flatMap((line) =>
        wrapText(line, contentWidth),
    );
    const maxOffset = Math.max(0, wrapped.length - height);
    const start = Math.min(offset, maxOffset);
    const commands: Record<string, () => void> = {
        l: () => {
            if (details) setLogs(true);
        },
        i: () => {
            setInspect((value) => !value);
            setOffset(0);
        },
        r: () => setRevision((value) => value + 1),
        s: () => act(running ? 'stop' : 'start'),
        x: () => act('restart'),
    };
    useInput(
        (input, key) => {
            if (key.escape || input === 'q') {
                onClose();
                return;
            }
            if (commands[input]) return commands[input]();
            if (key.upArrow || key.pageUp)
                setOffset(Math.max(0, start - (key.pageUp ? height : 1)));
            else if (key.downArrow || key.pageDown)
                setOffset(
                    Math.min(maxOffset, start + (key.pageDown ? height : 1)),
                );
        },
        { isActive: !logs },
    );
    const name = details?.name ?? id.slice(0, 12);
    const spinner = useSpinner(!!busy || loading);
    return {
        frame: { columns, rows, paddingX, height, start, wrapped },
        status: {
            name,
            inspect,
            busy,
            loading,
            spinner,
            running,
            allowed,
            environmentBusy,
            error,
            notice,
        },
        logs,
        closeLogs: () => setLogs(false),
    };
}

export default function ContainerDetails(props: ContainerDetailsProps) {
    const { frame, status, logs, closeLogs } = useContainerDetailState(props);
    const { columns, rows, paddingX, height, start, wrapped } = frame;
    if (logs)
        return (
            <ServiceLogs
                fullScreen
                name={status.name}
                load={(tail, signal) =>
                    props.manager.logs(props.id, tail, signal)
                }
                onClose={closeLogs}
            />
        );
    return (
        <Box
            width={columns}
            height={rows}
            backgroundColor={theme.background}
            paddingX={paddingX}
            flexDirection="column"
            overflow="hidden"
        >
            <Box flexDirection="column" flexShrink={0}>
                <ScreenHeader
                    title={
                        status.inspect
                            ? 'Containers / Inspect'
                            : 'Containers / Details'
                    }
                />
                <DetailStatus {...status} />
            </Box>
            <DetailBody wrapped={wrapped} start={start} height={height} />
            <Box flexGrow={1} />
            <KeyboardHints>↑ ↓ PgUp PgDn scroll · Esc back</KeyboardHints>
        </Box>
    );
}
