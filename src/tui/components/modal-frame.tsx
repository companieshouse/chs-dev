import { Box, Text, useWindowSize } from 'ink';
import type { ReactNode } from 'react';
import { theme } from './theme.js';

/** Centred modal that fills short terminals and clips instead of overflowing. */
export default function ModalFrame({
    title,
    width = 90,
    children,
    fillHeight = false,
    paddingX,
    paddingY,
}: {
    title: ReactNode;
    width?: number;
    fillHeight?: boolean;
    paddingX?: number;
    paddingY?: number;
    children: ReactNode;
}) {
    const { columns, rows } = useWindowSize();
    return (
        <Box
            position="absolute"
            width={columns}
            height={rows}
            alignItems="center"
            justifyContent="center"
        >
            <Box
                width={Math.max(1, Math.min(width, columns))}
                height={fillHeight ? rows : undefined}
                maxHeight={Math.max(1, rows)}
                flexDirection="column"
                borderStyle="round"
                borderColor={theme.accent}
                backgroundColor={theme.background}
                paddingX={paddingX ?? (columns >= 12 ? 2 : 0)}
                paddingY={paddingY ?? (rows >= 16 ? 1 : 0)}
                overflow="hidden"
            >
                <Text bold color={theme.foreground} wrap="truncate-end">
                    {title}
                </Text>
                {children}
            </Box>
        </Box>
    );
}

/** Rows available for a list inside a modal, leaving room for other lines. */
export function modalListHeight(rows: number, reserved: number): number {
    return Math.max(1, rows - reserved);
}
