import { useEffect, useRef, useState } from 'react';
import type {
    EnvironmentProfile,
    ProfilePreview,
} from '../../domain/environment-profile.js';
import { useClient } from '../context.js';
import type { Client } from '../../client/client.js';
import type { Scope } from '../../protocol/types.js';

export type ProfileScreen =
    | { kind: 'menu' }
    | { kind: 'input'; action: 'export' | 'import' }
    | {
          kind: 'review';
          preview: ProfilePreview;
      };

export function useProfileTask() {
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const pending = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => pending.current?.abort(), []);

    const run = async (action: (signal: AbortSignal) => Promise<void>) => {
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await action(controller.signal);
        } catch (failure) {
            if (!controller.signal.aborted)
                setError(String((failure as Error).message));
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    return {
        busy,
        notice,
        error,
        run,
        setNotice,
        setError,
        cancel: () => {
            pending.current?.abort();
            setBusy(false);
        },
    };
}

async function readProfileInput(
    client: Client,
    scope: Scope,
    input: { action: 'export' | 'import'; value: string },
    signal: AbortSignal,
) {
    if (input.action === 'export') {
        const result = await client.command(
            'environment.profileExport',
            { path: input.value },
            scope,
        );
        signal.throwIfAborted();
        return {
            notice: `Exported ${result.path}. ${result.warnings.join(' ')}`,
        };
    }
    const profile = await client.query(
        'environment.profileRead',
        { path: input.value },
        signal,
        scope,
    );
    return { profile };
}

export function useEnvironmentProfiles() {
    const client = useClient();
    const [scope] = useState(() => client.getSnapshot().scope);
    const [screen, setScreen] = useState<ProfileScreen>({ kind: 'menu' });
    const task = useProfileTask();
    const preview = async (
        profile: EnvironmentProfile,
        signal: AbortSignal,
    ) => {
        const result = await client.query(
            'environment.profilePreview',
            { profile, versionsOnly: false },
            signal,
            scope,
        );
        setScreen({ kind: 'review', preview: result });
    };
    const submit = (value: string) => {
        if (screen.kind !== 'input') return;
        void task.run(async (signal) => {
            const result = await readProfileInput(
                client,
                scope,
                { action: screen.action, value },
                signal,
            );
            if (result.notice !== undefined) {
                task.setNotice(result.notice);
                setScreen({ kind: 'menu' });
                return;
            }
            await preview(result.profile!, signal);
        });
    };
    const save = () => {
        if (screen.kind !== 'review') return;
        void task.run(async (signal) => {
            await client.command(
                'environment.profileImport',
                {
                    profile: screen.preview.profile,
                    versionsOnly: false,
                    revision: screen.preview.revision,
                },
                scope,
            );
            signal.throwIfAborted();
            task.setNotice(
                'Configuration saved. Choose Apply or Start when ready.',
            );
            setScreen({ kind: 'menu' });
        });
    };
    return {
        screen,
        busy: task.busy,
        notice: task.notice,
        error: task.error,
        submit,
        save,
        directory: client.getSnapshot().project.directory,
        menu: () => {
            task.cancel();
            setScreen({ kind: 'menu' });
            task.setError('');
        },
        open: (action: 'export' | 'import') => {
            setScreen({ kind: 'input', action });
            task.setError('');
            task.setNotice('');
        },
    };
}
