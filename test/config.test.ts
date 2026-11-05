import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { readProjectConfig } from '../src/project/config.js';

test('defaults an empty or blank project directory to the working directory', async () => {
    for (const value of ['', '   ']) {
        const config = await readProjectConfig(value);
        assert.equal(config.valid, false);
        assert.equal(config.directory, process.cwd());
    }
});

test('validates checkout structure and accepts renamed and relative paths', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-project-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    assert.equal((await readProjectConfig(join(root, 'missing'))).valid, false);
    await writeFile(join(root, 'ordinary-file'), '');
    assert.match(
        (await readProjectConfig(join(root, 'ordinary-file'))).message,
        /not a directory/,
    );

    const empty = await readProjectConfig(root);
    assert.equal(empty.valid, false);
    assert.match(empty.message, /services\/modules/);

    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'services/modules'), { recursive: true });
    await mkdir(join(root, 'services/infrastructure'));
    await writeFile(join(root, 'global.env'), '');
    await writeFile(join(root, 'bin/chs-dev'), '');
    const valid = await readProjectConfig(relative(process.cwd(), root));
    assert.equal(valid.valid, true);
    assert.equal(valid.directory, root);
    assert.equal((await readProjectConfig('', root)).valid, true);

    await rm(join(root, 'global.env'));
    await mkdir(join(root, 'global.env'));
    const wrongType = await readProjectConfig(root);
    assert.equal(wrongType.valid, false);
    assert.match(wrongType.message, /global\.env/);
});
