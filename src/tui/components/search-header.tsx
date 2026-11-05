import { Text } from 'ink';
import { theme } from './theme.js';

export default function SearchHeader({
    searching,
    query,
    hint,
    children,
}: {
    searching: boolean;
    query: string;
    hint: string;
    children?: import('react').ReactNode;
}) {
    const label = searching ? `/${query}▏` : query ? `Filter: ${query}` : hint;
    return (
        <Text
            color={searching ? theme.accent : theme.muted}
            wrap="truncate-end"
        >
            {label}
            {children}
        </Text>
    );
}
