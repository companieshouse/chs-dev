import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveServiceState } from '../src/domain/service-state.js';
import { serviceMode, type ServiceGroup } from '../src/domain/services.js';

test('configuration rules run without IO and leave their inputs untouched', () => {
    const groups: ServiceGroup[] = [
        {
            name: 'api',
            services: ['api'],
            definitions: {
                api: {
                    module: 'api',
                    dependencies: [],
                    base: false,
                    deprecated: false,
                },
            },
        },
    ];
    const state = Object.freeze({
        modules: Object.freeze(['api']),
        servicesWithLiveUpdate: Object.freeze(['api']),
    });
    assert.deepEqual(resolveServiceState(state, groups), {
        api: {
            enabled: 'Yes',
            mode: 'Development',
            effectiveStartMode: 'always',
            startModeSource: 'manual',
        },
    });
    assert.equal(serviceMode('sockpuppet', false), 'Mock');
    assert.equal(serviceMode('sockpuppet', true), 'Development');
    assert.throws(
        () => resolveServiceState({ modules: 'api' }, groups),
        /Invalid modules/,
    );
    assert.throws(
        () => resolveServiceState(null, groups),
        /Expected a state mapping/,
    );
});
