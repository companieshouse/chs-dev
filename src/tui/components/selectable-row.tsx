import { Box, Text } from 'ink';
import { theme } from './theme.js';

export default function SelectableRow({
    selected,
    heading = false,
    wrap = 'truncate-end',
    children,
}: {
    selected: boolean;
    heading?: boolean;
    wrap?: 'truncate-end' | 'truncate-middle' | 'wrap';
    children: string;
}) {
    return (
        <Box
            flexShrink={0}
            backgroundColor={selected ? theme.selectionBackground : undefined}
        >
            <Text
                wrap={wrap}
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
