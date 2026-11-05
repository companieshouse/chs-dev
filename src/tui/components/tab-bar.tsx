import { Box, Text } from 'ink';
import { tabs, type Tab } from '../models/navigation.js';
import { theme } from './theme.js';

export default function TabBar({
    active,
    width,
}: {
    active: Tab;
    width: number;
}) {
    return (
        <Box width={width} height={1} flexShrink={0}>
            <Text wrap="truncate-end">
                {tabs.map((tab, index) => (
                    <Text key={tab}>
                        {index > 0 ? '  ' : ''}
                        <Text
                            bold={tab === active}
                            color={tab === active ? theme.accent : theme.muted}
                        >
                            {tab === active ? `[${tab}]` : tab}
                        </Text>
                    </Text>
                ))}
            </Text>
        </Box>
    );
}
