import type { RuntimeStrategy } from '../../domain/runtime-strategy.js';
import { DockerNativeStrategy } from './docker-native.js';
import { DockerComposeStrategy } from './docker-compose.js';
import { activeSettings } from '../settings.js';
import { AppleNativeStrategy } from './apple-native.js';

export { supportedRuntimes } from '../../domain/settings.js';

export function selectRuntime(
    value = activeSettings().runtime.value,
    orchestrator = activeSettings().orchestrator.value,
): RuntimeStrategy {
    const id = value?.trim().toLowerCase() || 'docker';
    if (!['compose', 'native'].includes(orchestrator))
        throw new Error(
            `Unsupported CHS_DEV_ORCHESTRATOR \"${orchestrator}\". Supported: compose, native.`,
        );
    if (id === 'docker')
        return orchestrator === 'native'
            ? new DockerNativeStrategy()
            : new DockerComposeStrategy();
    if (id === 'apple') {
        if (orchestrator !== 'native')
            throw new Error(
                'Apple containers require native orchestration. Set orchestrator: native or CHS_DEV_ORCHESTRATOR=native.',
            );
        return new AppleNativeStrategy();
    }
    throw new Error(
        `Unsupported CHS_DEV_RUNTIME "${id}". Supported runtimes: docker, apple (set it in Config or the settings file).`,
    );
}
