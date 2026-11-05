import assert from 'node:assert/strict';
import {
    mkdtemp,
    mkdir,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    SshSetupService,
    sshSetupFiles,
} from '../src/infrastructure/ssh-setup.js';
import type { SshSecretRequirement } from '../src/domain/live.js';

const requirement: SshSecretRequirement = {
    kind: 'docker-ssh-secrets',
    services: ['accounts-filing-web'],
    keyPath: 'local/.ssh_key',
    passphrasePath: 'local/.ssh_key_passphrase',
};

test('discovers a safe SSH identity, creates Docker secret files, and is idempotent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-dev-ssh-'));
    const key = join(directory, 'id_ed25519');
    const requests: string[][] = [];
    try {
        await mkdir(join(directory, 'local'));
        await writeFile(key, 'fixture key');
        const service = new SshSetupService({
            directory,
            files: sshSetupFiles,
            execute: async (request) => {
                requests.push(request.args);
                return {
                    code: 0,
                    stdout: `identityfile ${key}\n`,
                    stderr: '',
                };
            },
        });
        await sshSetupFiles.chmod(key, 0o600);
        const before = await service.inspect([requirement]);
        assert.equal(before.ready, false);
        assert.equal(before.keyState, 'missing');
        assert.equal(before.passphraseState, 'missing');
        assert.equal(before.discoveredKey, key);
        await service.setup([requirement], {
            keyPath: key,
            passphrase: '',
            replace: false,
        });
        const ready = await service.inspect([requirement]);
        assert.equal(ready.ready, true);
        assert.equal(ready.keyState, 'valid');
        assert.equal(ready.passphraseState, 'valid');
        assert.equal(
            await sshSetupFiles.realpath(join(directory, 'local/.ssh_key')),
            await sshSetupFiles.realpath(key),
        );
        assert.equal(
            (await stat(join(directory, 'local/.ssh_key_passphrase'))).mode &
                0o777,
            0o600,
        );
        assert.equal(
            await readFile(
                join(directory, 'local/.ssh_key_passphrase'),
                'utf8',
            ),
            '',
        );
        await service.setup([requirement], {
            keyPath: key,
            passphrase: '',
            replace: false,
        });
        assert.deepEqual(requests, [
            ['-G', 'github.com'],
            ['-G', 'github.com'],
        ]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('rejects unsafe key files and repairs insecure passphrase files only explicitly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-dev-ssh-'));
    const key = join(directory, 'id_rsa');
    try {
        await mkdir(join(directory, 'local'));
        await writeFile(key, 'fixture key');
        await sshSetupFiles.chmod(key, 0o644);
        const service = new SshSetupService({
            directory,
            files: sshSetupFiles,
            execute: async () => ({
                code: 0,
                stdout: `identityfile ${key}\n`,
                stderr: '',
            }),
        });
        const unsafe = await service.inspect([requirement]);
        assert.equal(unsafe.discoveredKey, undefined);
        await assert.rejects(
            service.setup([requirement], {
                keyPath: key,
                passphrase: '',
                replace: false,
            }),
            /unsafe permissions/,
        );
        await sshSetupFiles.chmod(key, 0o600);
        await service.setup([requirement], {
            keyPath: key,
            passphrase: '',
            replace: false,
        });
        await sshSetupFiles.chmod(
            join(directory, 'local/.ssh_key_passphrase'),
            0o644,
        );
        const invalid = await service.inspect([requirement]);
        assert.equal(invalid.ready, false);
        assert.equal(invalid.passphraseState, 'invalid');
        await assert.rejects(
            service.setup([requirement], {
                keyPath: key,
                passphrase: 'secret',
                replace: false,
            }),
            /explicit repair/,
        );
        await service.setup([requirement], {
            keyPath: key,
            passphrase: 'secret',
            replace: true,
        });
        assert.equal(
            await readFile(
                join(directory, 'local/.ssh_key_passphrase'),
                'utf8',
            ),
            'secret',
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('failed secret installation cleans every created path even after an unlink failure', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-dev-ssh-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const key = join(directory, 'identity');
    await writeFile(key, 'fixture key', { mode: 0o600 });
    const removed: string[] = [];
    const cleanupFailure = new Error('unlink failed');
    const service = new SshSetupService({
        directory,
        execute: async () => ({ code: 0, stdout: '', stderr: '' }),
        files: {
            ...sshSetupFiles,
            chmod: async () => {
                throw new Error('chmod failed');
            },
            unlink: async (path) => {
                removed.push(path);
                if (removed.length === 1) throw cleanupFailure;
                await sshSetupFiles.unlink(path);
            },
        },
    });
    await assert.rejects(
        service.setup([requirement], {
            keyPath: key,
            passphrase: '',
            replace: false,
        }),
        (error: Error) => {
            assert.match(
                error.message,
                /Cannot create Container SSH secret files/,
            );
            assert.ok(error.cause instanceof AggregateError);
            assert.deepEqual(error.cause.errors, [cleanupFailure]);
            return true;
        },
    );
    assert.equal(removed.length, 2);
    assert.match(removed[0], /\.ssh_key_passphrase\.tmp-/);
    assert.equal(removed[1], join(directory, 'local/.ssh_key'));
    assert.equal(await readFile(key, 'utf8'), 'fixture key');
    await assert.rejects(
        sshSetupFiles.lstat(join(directory, 'local/.ssh_key')),
        { code: 'ENOENT' },
    );
});

test('pre-existing passphrase requires repair before a new key link is written', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-dev-ssh-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const key = join(directory, 'identity');
    await writeFile(key, 'fixture key', { mode: 0o600 });
    await mkdir(join(directory, 'local'));
    const passphrase = join(directory, 'local/.ssh_key_passphrase');
    await writeFile(passphrase, 'existing', { mode: 0o600 });
    let writes = 0;
    const service = new SshSetupService({
        directory,
        execute: async () => ({ code: 0, stdout: '', stderr: '' }),
        files: {
            ...sshSetupFiles,
            symlink: async (target, path) => {
                writes++;
                await sshSetupFiles.symlink(target, path);
            },
        },
    });
    await assert.rejects(
        service.setup([requirement], {
            keyPath: key,
            passphrase: 'new',
            replace: false,
        }),
        /explicit repair/,
    );
    assert.equal(writes, 0);
    assert.equal(await readFile(passphrase, 'utf8'), 'existing');
});
