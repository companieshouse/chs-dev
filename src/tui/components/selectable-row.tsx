import { Box, Text } from 'ink';
import { theme } from './theme.js';

export default function SelectableRow({
    selected,
    heading = false,
    children,
}: {
    selected: boolean;
    heading?: boolean;
    children: string;
}) {
    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Text
                wrap="truncate-end"
                bold={heading || selected}
                color={
                    heading
                        ? theme.accent
                        : selected
                          ? theme.selectionText
                          : theme.foreground
                }
            >
                <Text bold color={theme.accent}>
                    {selected ? '›' : ' '}
                </Text>{' '}
                {children}
            </Text>
        </Box>
    );
}
