import { resolve } from 'node:path';
import { expandHome } from '../infrastructure/settings.js';
import {
    resolveSettings,
    settingKeys,
    settingLabels,
} from '../domain/settings.js';
import type { SessionSnapshot } from '../protocol/types.js';

/** Startup inputs are explicit and contain no short-lived cloud credentials. */
export function daemonEnvironment(env: NodeJS.ProcessEnv = process.env) {
    const names = [
        'PATH',
        'HOME',
        'USER',
        'LOGNAME',
        'TMPDIR',
        'XDG_CONFIG_HOME',
        'XDG_STATE_HOME',
        'CHS_DEV_SOCKET',
        'CHS_DEV_PROJECT',
        'CHS_DEV_RUNTIME',
        'CHS_DEV_ORCHESTRATOR',
        'CHS_DEV_ECR_PROFILES',
        'CHS_DEV_AUTO_APPLY',
        'CHS_DEV_LOGIN',
        'CHS_DEV_AUTO_LOGIN',
        'CHS_DEV_APPLE_CLI',
        'AWS_PROFILE',
        'AWS_DEFAULT_PROFILE',
        'AWS_CONFIG_FILE',
        'AWS_SHARED_CREDENTIALS_FILE',
        'DOCKER_HOST',
        'DOCKER_CONTEXT',
        'DOCKER_CONFIG',
    ];
    const selected: NodeJS.ProcessEnv = Object.fromEntries(
        names.flatMap((name) => (env[name] ? [[name, env[name]]] : [])),
    );
    if (selected.CHS_DEV_PROJECT)
        selected.CHS_DEV_PROJECT = resolve(
            expandHome(selected.CHS_DEV_PROJECT),
        );
    return selected;
}

export function environmentMismatch(
    snapshot: SessionSnapshot,
    env: NodeJS.ProcessEnv = process.env,
) {
    const requested = resolveSettings({}, daemonEnvironment(env));
    const different = settingKeys.filter(
        (key) =>
            requested[key].source === 'env' &&
            JSON.stringify(requested[key].value) !==
                JSON.stringify(snapshot.settings.resolved[key].value),
    );
    return different.length
        ? `Connected to the existing daemon. This shell differs for: ${different.map((key) => settingLabels[key]).join(', ')}. Review Config; connecting does not change the shared environment.`
        : undefined;
}
