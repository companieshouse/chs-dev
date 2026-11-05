import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { useClient } from '../context.js';
import { useProfileTask } from '../hooks/use-environment-profiles.js';
import { saveVersionSource } from '../../client/version-sources.js';
import {
    versionSourceLabels,
    versionSources,
    isAwsEnvironment,
    type VersionSource,
} from '../../domain/version-sources.js';
import { ProfileStatus } from './profile-controls.js';
import ModalFrame from './modal-frame.js';
import SelectableRow from './selectable-row.js';
import KeyboardHints from './keyboard-hints.js';
import { theme } from './theme.js';

function useVersionSource() {
    const client = useClient();
    const [scope] = useState(() => client.getSnapshot().scope);
    const [source, setSource] = useState<VersionSource>('cidev');
    const [selected, setSelected] = useState(0);
    const [loading, setLoading] = useState(true);
    const [initialError, setInitialError] = useState('');
    const [pins, setPins] = useState(0);
    const task = useProfileTask();
    useEffect(() => {
        const abort = new AbortController();
        void client
            .query('configuration.snapshot', {}, abort.signal, scope)
            .then((current) => {
                const source = current.selections.versionSource ?? 'cidev';
                setSource(source);
                setSelected(versionSources.indexOf(source));
                setPins(
                    Object.keys(current.selections.serviceImages ?? {}).length,
                );
                setLoading(false);
            })
            .catch((error: Error) => {
                if (abort.signal.aborted) return;
                setInitialError(error.message);
                setLoading(false);
            });
        return () => abort.abort();
    }, [client, scope]);
    const save = () =>
        void task.run(async (signal) => {
            const selectedSource = versionSources[selected];
            await saveVersionSource(client, selectedSource, scope, signal);
            signal.throwIfAborted();
            setSource(selectedSource);
            task.setNotice(
                `${versionSourceLabels[selectedSource]} selected. Choose Apply or Start when ready.`,
            );
        });
    const refresh = () =>
        void task.run(async (signal) => {
            const source = versionSources[selected];
            if (!isAwsEnvironment(source)) return;
            const result = await client.query(
                'environment.versionSnapshot',
                { source, refresh: true },
                signal,
                scope,
            );
            task.setNotice(
                `${versionSourceLabels[source]}: ${result.matches.length} versions refreshed. ${result.ambiguous.length} ambiguous services. Apply when ready.`,
            );
        });
    return {
        source,
        selected,
        loading,
        pins,
        save,
        refresh,
        status: {
            busy: loading || task.busy,
            error: initialError || task.error,
            notice: task.notice,
        },
        move: (backward: boolean) =>
            setSelected(
                (value) =>
                    (value + (backward ? versionSources.length : 1)) %
                    (versionSources.length + 1),
            ),
    };
}

export default function VersionSourceModal({ onClose }: { onClose(): void }) {
    const versions = useVersionSource();
    useInput((input, key) => {
        if (key.escape) return onClose();
        if (versions.status.busy) return;
        if (key.upArrow || key.downArrow) versions.move(key.upArrow);
        if (input === 'r') versions.refresh();
        if (!key.return) return;
        if (versions.selected === versionSources.length) return onClose();
        versions.save();
    });
    return (
        <ModalFrame
            title={`Service versions · ${versionSourceLabels[versions.source]}`}
        >
            <Text color={theme.muted}>
                Choose the default version source for Service providers.
            </Text>
            <Box flexDirection="column" marginY={1}>
                {versionSources.map((source, index) => (
                    <SelectableRow
                        key={source}
                        selected={versions.selected === index}
                    >{`${source === versions.source ? '●' : '○'} ${versionSourceLabels[source]}${source === 'cidev' ? ' (default)' : ''}`}</SelectableRow>
                ))}
                <SelectableRow
                    selected={versions.selected === versionSources.length}
                >
                    Back
                </SelectableRow>
            </Box>
            <Text color={theme.muted}>
                Versions resolve automatically on Apply / Start; r refreshes
                them.
            </Text>
            <Text color={theme.muted}>
                Mock, Development and infrastructure keep their providers.
            </Text>
            {versions.pins > 0 && (
                <Text color={theme.development}>
                    {versions.pins} explicit image pins override the default
                    source.
                </Text>
            )}
            <ProfileStatus {...versions.status} />
            <KeyboardHints>
                ↑ ↓ choose · Enter use · r refresh · Esc back
            </KeyboardHints>
        </ModalFrame>
    );
}
