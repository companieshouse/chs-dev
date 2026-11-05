import { Box } from 'ink';
import type { ReactNode } from 'react';

export default function TabScreen({
    height,
    children,
    footer,
}: {
    height: number;
    children: ReactNode;
    footer?: ReactNode;
}) {
    return (
        <Box height={height} flexDirection="column" overflow="hidden">
            <Box flexShrink={0} flexDirection="column">
                {children}
            </Box>
            <Box flexGrow={1} />
            {footer}
        </Box>
    );
}
