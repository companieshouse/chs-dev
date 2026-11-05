import { Text } from 'ink';
import { theme } from './theme.js';
import { useSpinner } from '../hooks/use-spinner.js';

export default function Spinner({ label }: { label: string }) {
    const spinner = useSpinner();
    return (
        <Text color={theme.muted} wrap="truncate-end">
            <Text color={theme.accent}>{spinner}</Text> {label}
        </Text>
    );
}
