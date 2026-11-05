import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Key } from 'ink';
import { tabDirection, nextTab } from '../src/tui/models/navigation.js';

const key = (value: Partial<Key>) => value as Key;

test('arrow keys always leave Modules while plain Tab belongs to its panels', () => {
    assert.equal(tabDirection('', key({ leftArrow: true }), true), -1);
    assert.equal(tabDirection('', key({ rightArrow: true }), true), 1);
    assert.equal(tabDirection('', key({ tab: true }), true), null);
    assert.equal(tabDirection('', key({ tab: true, shift: true }), true), null);
    assert.equal(tabDirection('', key({ tab: true, ctrl: true }), true), 1);
    assert.equal(tabDirection('p', key({ ctrl: true }), true), -1);
    assert.equal(tabDirection('n', key({ ctrl: true }), true), 1);
});

test('normal tabs wrap and search text is not consumed as navigation', () => {
    assert.equal(nextTab('Services', -1), 'Config');
    assert.equal(nextTab('Config', 1), 'Services');
    assert.equal(nextTab('Modules', 1), 'Enabled');
    assert.equal(nextTab('Services', 1), 'Containers');
    assert.equal(nextTab('Containers', -1), 'Services');
    assert.equal(tabDirection('', key({ tab: true, shift: true })), -1);
    assert.equal(tabDirection('n', key({})), null);
    assert.equal(tabDirection('p', key({})), null);
    assert.equal(tabDirection('/', key({})), null);
});
