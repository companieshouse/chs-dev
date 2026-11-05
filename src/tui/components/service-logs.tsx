import ModalFrame from './modal-frame.js';
import { Box, Text, useInput, useWindowSize } from 'ink';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import wrapAnsi from 'wrap-ansi';
import KeyboardHints from './keyboard-hints.js';
import { theme } from './theme.js';
import ScreenHeader from './screen-header.js';

const tail = 200;

function useLogFeed(
    load: (tail: number, signal: AbortSignal) => Promise<string[]>,
) {
    const [lines, setLines] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Lines scrolled up from the newest entry.
    const [offset, setOffset] = useState(0);
    const abort = useRef<AbortController>(undefined);
    // Callers pass inline functions; keep refresh stable across renders.
    const loader = useRef(load);
    loader.current = load;
    const refresh = useCallback(() => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setLoading(true);
        setError('');
        loader
            .current(tail, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setLines(result);
                setOffset(0);
            })
            .catch((failure: unknown) => {
                if (controller.signal.aborted) return;
                setError(
                    failure instanceof Error
                        ? failure.message
                        : String(failure),
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
    }, []);
    useEffect(() => {
        refresh();
        return () => abort.current?.abort();
    }, [refresh]);
    return { lines, loading, error, offset, setOffset, refresh };
}

function logStatus(
    loading: boolean,
    error: string,
    count: number,
    offset: number,
) {
    return loading
        ? 'loading…'
        : error
          ? 'failed'
          : `last ${count} line${count === 1 ? '' : 's'}${offset ? ` · ${offset} rows below` : ''}`;
}

export default function ServiceLogs({
    name,
    load,
    onClose,
    fullScreen = false,
}: {
    name: string;
    load(tail: number, signal: AbortSignal): Promise<string[]>;
    onClose(): void;
    fullScreen?: boolean;
}) {
    const { columns, rows } = useWindowSize();
    const { lines, loading, error, offset, setOffset, refresh } =
        useLogFeed(load);

    const width = Math.max(1, fullScreen ? columns : Math.min(120, columns));
    const paddingX = columns >= 12 ? 1 : 0;
    const contentWidth = Math.max(
        1,
        width - (fullScreen ? 0 : 2) - paddingX * 2,
    );
    const height = Math.max(1, rows - 4);
    const wrapped = useMemo(
        () =>
            lines.flatMap((line) =>
                wrapAnsi(line, contentWidth, { hard: true, trim: false }).split(
                    '\n',
                ),
            ),
        [lines, contentWidth],
    );
    const maxOffset = Math.max(0, wrapped.length - height);
    const visibleOffset = Math.min(offset, maxOffset);
    const end = wrapped.length - visibleOffset;
    const visible = wrapped.slice(Math.max(0, end - height), end);

    useInput((input, key) => {
        if (key.escape || input === 'q') onClose();
        else if (input === 'r') refresh();
        else if (key.upArrow || key.pageUp) {
            const step = key.pageUp ? Math.max(1, height - 1) : 1;
            setOffset(Math.min(maxOffset, visibleOffset + step));
        } else if (key.downArrow || key.pageDown) {
            const step = key.pageDown ? Math.max(1, height - 1) : 1;
            setOffset(Math.max(0, visibleOffset - step));
        }
    });

    const status = logStatus(loading, error, lines.length, visibleOffset);
    return (
        <LogFrame
            fullScreen={fullScreen}
            paddingX={paddingX}
            title={
                <>
                    <Text bold color={theme.foreground}>
                        {name} logs
                    </Text>
                    <Text bold={false} color={theme.muted}>
                        {' '}
                        · {status}
                    </Text>
                </>
            }
        >
            <LogBody
                height={height}
                error={error}
                loading={loading}
                visible={visible}
            />
            <KeyboardHints>
                ↑ ↓ PgUp PgDn scroll · r refresh · Esc back
            </KeyboardHints>
        </LogFrame>
    );
}

function LogBody({
    height,
    error,
    loading,
    visible,
}: {
    height: number;
    error: string;
    loading: boolean;
    visible: string[];
}) {
    return (
        <Box
            flexDirection="column"
            height={height}
            overflow="hidden"
            flexShrink={0}
        >
            {error ? (
                <Text color={theme.error} wrap="truncate-end">
                    {error}
                </Text>
            ) : !loading && !visible.length ? (
                <Text color={theme.muted}>No output yet.</Text>
            ) : (
                visible.map((line, index) => (
                    <Text
                        key={index}
                        color={theme.foreground}
                        wrap="truncate-end"
                    >
                        {line || ' '}
                    </Text>
                ))
            )}
        </Box>
    );
}

function LogFrame({
    fullScreen,
    paddingX,
    title,
    children,
}: {
    fullScreen: boolean;
    paddingX: number;
    title: ReactNode;
    children: ReactNode;
}) {
    const { columns, rows } = useWindowSize();
    if (!fullScreen)
        return (
            <ModalFrame
                width={120}
                fillHeight
                paddingX={paddingX}
                paddingY={0}
                title={title}
            >
                {children}
            </ModalFrame>
        );
    return (
        <Box
            width={columns}
            height={rows}
            paddingX={paddingX}
            flexDirection="column"
            backgroundColor={theme.background}
            overflow="hidden"
        >
            <ScreenHeader title="Containers / Logs" />
            <Text bold color={theme.foreground} wrap="truncate-end">
                {title}
            </Text>
            {children}
        </Box>
    );
}
