import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { optionalJson } from '../src/infrastructure/state-files.js';

test('optional state reads distinguish absent files from corrupted state', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-state-files-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'state.json');
    assert.equal(await optionalJson(path), undefined);
    await writeFile(path, '{"value":1}');
    assert.deepEqual(await optionalJson(path), { value: 1 });
    await writeFile(path, '{');
    await assert.rejects(optionalJson(path), SyntaxError);
});
