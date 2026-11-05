import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { setTimeout as delay } from 'node:timers/promises';
import { usePollingEffect } from '../src/tui/hooks/use-polling-effect.js';
import { terminal } from './support/terminal.js';

async function until(check: () => boolean) {
    const deadline = Date.now() + 2000;
    while (!check()) {
        assert.ok(Date.now() < deadline, 'Polling transition did not complete');
        await delay(5);
    }
}

test(
    'polling is serial and cancels old generations on suspension, revision changes and unmount',
    { timeout: 5000 },
    async (t) => {
        const calls: { signal: AbortSignal; finish(): void }[] = [];
        const refresh = (signal: AbortSignal) => {
            const pending = Promise.withResolvers<void>();
            calls.push({ signal, finish: pending.resolve });
            return pending.promise;
        };
        function Probe({
            enabled,
            revision,
        }: {
            enabled: boolean;
            revision: number;
        }) {
            usePollingEffect(enabled, refresh, 20, revision);
            return null;
        }
        const term = terminal(
            createElement(Probe, { enabled: false, revision: 0 }),
        );
        t.after(() => term.app.unmount());
        await delay(40);
        assert.equal(calls.length, 0);
        term.rerender(createElement(Probe, { enabled: true, revision: 0 }));
        await until(() => calls.length === 1);
        await delay(60);
        assert.equal(
            calls.length,
            1,
            'A pending poll must not overlap another poll',
        );
        term.rerender(createElement(Probe, { enabled: true, revision: 0 }));
        await delay(40);
        assert.equal(
            calls.length,
            1,
            'An unrelated render must not restart polling',
        );
        term.rerender(createElement(Probe, { enabled: false, revision: 0 }));
        await until(() => calls[0].signal.aborted);
        calls[0].finish();
        await delay(40);
        assert.equal(
            calls.length,
            1,
            'A cancelled completion must not schedule a poll',
        );
        term.rerender(createElement(Probe, { enabled: true, revision: 0 }));
        await until(() => calls.length === 2);
        term.rerender(createElement(Probe, { enabled: true, revision: 1 }));
        await until(() => calls.length === 3);
        assert.equal(calls[1].signal.aborted, true);
        calls[1].finish();
        await delay(40);
        assert.equal(calls.length, 3);
        calls[2].finish();
        await until(() => calls.length === 4);
        term.app.unmount();
        await until(() => calls[3].signal.aborted);
        calls[3].finish();
        await delay(40);
        assert.equal(calls.length, 4);
    },
);
