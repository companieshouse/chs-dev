import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as fs from 'node:fs';
import { safeFields, TuiLog } from '../src/infrastructure/tui-log.js';

function fixture(maxBytes = 5000) {
    const files = new Map<string, string>();
    const warnings: string[] = [];
    let fail = false;
    const filesystem = {
        mkdirSync() {},
        lstatSync(path: string) {
            if (path === '/project') return { isDirectory: () => true };
            if (!files.has(path))
                throw Object.assign(new Error('secret path'), {
                    code: 'ENOENT',
                });
            return {
                isFile: () => true,
                nlink: 1,
                size: Buffer.byteLength(files.get(path)!),
            };
        },
        openSync(path: string, _flags: number, mode: number) {
            assert.equal(mode, 0o600);
            if (!files.has(path)) files.set(path, '');
            return path;
        },
        fstatSync() {
            return { isFile: () => true, nlink: 1 };
        },
        fchmodSync(_fd: unknown, mode: number) {
            assert.equal(mode, 0o600);
        },
        closeSync() {},
        writeFileSync(path: string, text: string) {
            if (fail) throw new Error('SECRET filesystem details');
            files.set(path, files.get(path)! + text);
        },
        unlinkSync(path: string) {
            files.delete(path);
        },
        renameSync(from: string, to: string) {
            files.set(to, files.get(from)!);
            files.delete(from);
        },
    } as unknown as typeof fs;
    const log = new TuiLog('/project', filesystem, maxBytes, (message) =>
        warnings.push(message),
    );
    return {
        files,
        log,
        warnings,
        filesystem,
        fail: () => {
            fail = true;
        },
    };
}

test('schema drops raw messages, YAML, output, credentials, paths and arbitrary fields', () => {
    assert.deepEqual(
        safeFields({
            status: 'SECRET',
            message: 'password: secret',
            stdout: 'token',
            env: { token: 'secret' },
            revision: 'secret',
            code: 1,
            category: 'aws',
            durationMs: 4,
            enabled: true,
        }),
        { code: 1, category: 'aws', durationMs: 4, enabled: true },
    );
});

test('poll transitions deduplicate while recording recovery', () => {
    const { log, files } = fixture();
    for (const state of ['ready', 'ready', 'error', 'error', 'ready'])
        log.transition('docker.status', state);
    assert.equal(files.get(log.path)!.trim().split('\n').length, 3);
});

test('schema never accepts coercible objects and log paths reject links', () => {
    assert.deepEqual(
        safeFields({
            category: { toString: () => 'aws', secret: 'PRIVATE' },
            signal: { toString: () => 'SIGINT', secret: 'PRIVATE' },
        }),
        {},
    );
    const f = fixture();
    f.filesystem.lstatSync = (() => ({
        isDirectory: () => false,
    })) as typeof f.filesystem.lstatSync;
    assert.throws(
        () => new TuiLog('/project', f.filesystem),
        /unsafe log directory/,
    );
});

test('rotation bounds only explicit names and preserves private writes', () => {
    const { log, files } = fixture(300);
    files.set('/project/unrelated', 'keep');
    for (let i = 0; i < 20; i++) log.write('startup');
    assert.equal(files.size, 4);
    for (const [path, content] of files)
        if (path !== '/project/unrelated')
            assert.ok(Buffer.byteLength(content) <= 300);
    assert.equal(files.get('/project/unrelated'), 'keep');
});

test('IO failures remain visible without altering operations or exposing errors', async () => {
    const f = fixture();
    f.fail();
    const result = await f.log.operation('config.save', {}, async () => 42);
    assert.equal(result, 42);
    assert.equal(f.warnings.length, 1);
    assert.match(f.log.getSnapshot().failure, /logging failed/);
    assert.doesNotMatch(JSON.stringify(f.log.getSnapshot()), /SECRET/);
    assert.throws(
        () => new TuiLog('/project', f.filesystem),
        /Cannot initialize/,
    );
});

test('operations correlate nested events and environment IDs without raw thrown details', async () => {
    const { log, files } = fixture();
    let correlation;
    await assert.rejects(
        log.operation('config.save', {}, async () => {
            await Promise.resolve();
            correlation = log.correlation();
            log.write('config.save', { status: 'validated' });
            throw new Error('SECRET YAML parser snippet');
        }),
    );
    const entries = files
        .get(log.path)!
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    assert.equal(new Set(entries.map((entry) => entry.operation)).size, 1);
    assert.equal(entries[0].session, log.session);
    assert.equal(entries.at(-1).status, 'failed');
    assert.deepEqual(correlation, {
        CHS_DEV_LOG_SESSION: log.session,
        CHS_DEV_LOG_OPERATION: entries[0].operation,
    });
    assert.doesNotMatch(files.get(log.path)!, /SECRET/);
    assert.equal(log.correlation().CHS_DEV_LOG_OPERATION, undefined);
});
