import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { LiveRuntime } from '../domain/live.js';
import { LiveFailure } from '../domain/live.js';
import { optionalJson, privateJson } from './native/state-files.js';

/** The checkout lock surrounds these calls; the marker survives TUI restarts. */
export function guardBackend(
    runtime: LiveRuntime,
    state: string,
    backend: string,
): LiveRuntime {
    const path = join(state, 'active-backend.json');
    const claim = async () => {
        const previous = await optionalJson<{ backend: string | null }>(path);
        if (previous?.backend && previous.backend !== backend)
            throw new LiveFailure(
                `This checkout still belongs to ${previous.backend}. Select it and Stop environment before switching to ${backend}. Data volumes will be kept.`,
                'blocked',
            );
        if (
            !previous &&
            backend === 'apple/native' &&
            (await access(join(state, 'native', 'fingerprint.key')).then(
                () => true,
                () => false,
            ))
        )
            throw new LiveFailure(
                'This checkout has legacy native Docker state. Select Docker / Native and Stop environment once before using Apple. Its data will be kept.',
                'blocked',
            );
        await privateJson(path, { backend });
    };
    const monitor = async (...args: any[]) => {
        const current = await optionalJson<{ backend: string | null }>(path);
        if (!current?.backend || current.backend === backend)
            return (runtime.monitor as Function).apply(runtime, args);
    };
    const claimAndRun =
        (key: 'apply' | 'reload') =>
        async (...args: any[]) => {
            await claim();
            return (runtime[key] as Function).apply(runtime, args);
        };
    const stopProject = async (...args: any[]) => {
        const previous = await optionalJson<{ backend: string | null }>(path);
        if (previous?.backend && previous.backend !== backend)
            throw new LiveFailure(
                `Select ${previous.backend} to stop this checkout's environment.`,
                'blocked',
            );
        const result = await (runtime.stopProject as Function).apply(
            runtime,
            args,
        );
        if (result.outcome === 'success')
            await privateJson(path, { backend: null });
        return result;
    };
    return new Proxy(runtime, {
        get(target, key) {
            if (key === 'monitor' && target.monitor) return monitor;
            if (key === 'apply' || key === 'reload') return claimAndRun(key);
            if (key === 'stopProject') return stopProject;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, key, value) {
            return Reflect.set(target, key, value, target);
        },
    });
}
