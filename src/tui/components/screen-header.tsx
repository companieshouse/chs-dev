import { Box, Text } from 'ink';
import { theme } from './theme.js';

export default function ScreenHeader({ title }: { title: string }) {
    return (
        <Box
            height={1}
            flexShrink={0}
            marginBottom={1}
            backgroundColor={theme.selectionBackground}
        >
            <Box flexShrink={0} marginRight={2}>
                <Text bold color={theme.accent}>
                    ← Back{' '}
                    <Text bold={false} color={theme.muted}>
                        (Esc)
                    </Text>
                </Text>
            </Box>
            <Box flexGrow={1} minWidth={0}>
                <Text bold color={theme.foreground} wrap="truncate-end">
                    {title}
                </Text>
            </Box>
        </Box>
    );
}
