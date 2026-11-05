import { Box, Text } from 'ink';
import { tabs, type Tab } from '../models/navigation.js';
import { theme } from './theme.js';

function TabCaps({ active }: { active: Tab }) {
    return tabs.map((tab, index) => (
        <Text key={tab}>
            {index > 0 ? ' ' : ''}
            <Text
                color={tab === active ? theme.accent : theme.inactiveTabBorder}
            >
                ╭{'─'.repeat(tab.length + 2)}╮
            </Text>
        </Text>
    ));
}

function TabLabels({ active }: { active: Tab }) {
    return tabs.map((tab, index) => (
        <Text key={tab}>
            {index > 0 ? ' ' : ''}
            <Text
                color={tab === active ? theme.accent : theme.inactiveTabBorder}
            >
                │{' '}
                <Text
                    bold={tab === active}
                    color={
                        tab === active
                            ? theme.activeTabText
                            : theme.inactiveTabText
                    }
                >
                    {tab}
                </Text>{' '}
                │
            </Text>
        </Text>
    ));
}

function TabJoins({ active }: { active: Tab }) {
    return tabs.map((tab, index) => (
        <Text key={tab}>
            {index > 0 ? '─' : ''}
            <Text
                color={tab === active ? theme.accent : theme.inactiveTabBorder}
            >
                {tab === active
                    ? `╯${' '.repeat(tab.length + 2)}╰`
                    : `┴${'─'.repeat(tab.length + 2)}┴`}
            </Text>
        </Text>
    ));
}

export default function TabBar({
    active,
    width,
}: {
    active: Tab;
    width: number;
}) {
    const join = `╭─${tabs
        .map((tab) =>
            tab === active
                ? `╯${' '.repeat(tab.length + 2)}╰`
                : `┴${'─'.repeat(tab.length + 2)}┴`,
        )
        .join('─')}`;
    return (
        <Box flexDirection="column" flexShrink={0}>
            <Text wrap="truncate-end" color={theme.border}>
                {'  '}
                <TabCaps active={active} />
            </Text>
            <Text wrap="truncate-end" color={theme.border}>
                {'  '}
                <TabLabels active={active} />
            </Text>
            <Text wrap="truncate-end" color={theme.border}>
                ╭─
                <TabJoins active={active} />
                {'─'.repeat(Math.max(0, width - join.length - 1))}╮
            </Text>
        </Box>
    );
}
