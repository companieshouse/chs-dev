import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as fs from 'node:fs';
import hostFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    initializeTuiLog,
    safeFields,
    TuiLog,
} from '../src/infrastructure/tui-log.js';

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
            if (!files.has(path))
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            files.delete(path);
        },
        renameSync(from: string, to: string) {
            if (!files.has(from))
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
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
        recover: () => {
            fail = false;
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

test('structured log fields retain valid values and reject unknown or coercible values', () => {
    const allowed = {
        durationMs: 0,
        code: 1,
        count: 3,
        enabled: false,
        development: true,
        status: 'ready',
        previousStatus: 'checking',
        category: 'config',
        signal: 'SIGTERM',
        setting: 'project',
        command: 'docker',
        subcommand: 'compose up',
        revision: 'a'.repeat(64),
        service: 'api-v2',
        cause: 'cold-start',
    };
    assert.deepEqual(safeFields(allowed), allowed);
    const rejected = {
        durationMs: Infinity,
        code: NaN,
        count: '3',
        enabled: 'false',
        development: 1,
        status: 'private status',
        previousStatus: 0,
        category: 'secret category',
        signal: 'UNKNOWN',
        setting: 'password',
        command: '/private/command',
        subcommand: 'compose password',
        revision: 'not-a-hash',
        service: '../private-path',
        cause: 'raw detail',
    };
    assert.deepEqual(safeFields(rejected), {});
    assert.deepEqual(safeFields({ subcommand: '' }), {});
    for (const key of ['command', 'subcommand', 'revision', 'service']) {
        assert.deepEqual(
            safeFields({
                [key]: { toString: () => allowed[key as keyof typeof allowed] },
            }),
            {},
        );
    }
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

test('a log exactly at its byte limit rotates when the next entry is written', () => {
    const f = fixture(256);
    const existing = 'x'.repeat(256);
    f.files.set(f.log.path, existing);
    const log = new TuiLog('/project', f.filesystem, 256);
    assert.equal(f.files.has(`${log.path}.1`), false);
    assert.equal(f.files.get(log.path), existing);
    log.write('startup');
    assert.equal(f.files.get(`${log.path}.1`), existing);
    assert.equal(JSON.parse(f.files.get(log.path)!).event, 'startup');
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

test('unsafe existing log paths and replaced file descriptors are rejected before writing', () => {
    for (const info of [
        { isFile: () => false, nlink: 1 },
        { isFile: () => true, nlink: 2 },
    ]) {
        const path = fixture();
        const inspect = path.filesystem.lstatSync;
        path.filesystem.lstatSync = ((name: string) =>
            name === '/project' ? inspect(name) : info) as typeof inspect;
        assert.throws(
            () => new TuiLog('/project', path.filesystem),
            /Cannot initialize/,
        );
        assert.equal(path.files.get(path.log.path), '');

        const descriptor = fixture();
        descriptor.filesystem.fstatSync = (() =>
            info) as typeof descriptor.filesystem.fstatSync;
        assert.throws(
            () => new TuiLog('/project', descriptor.filesystem),
            /Cannot initialize/,
        );
        assert.equal(descriptor.files.get(descriptor.log.path), '');
    }
});

test('rotation refuses an unsafe oldest backup and preserves existing logs', () => {
    for (const unsafe of [
        { isFile: () => false, nlink: 1 },
        { isFile: () => true, nlink: 2 },
    ]) {
        const f = fixture(256);
        f.files.set(f.log.path, 'x'.repeat(256));
        f.files.set(`${f.log.path}.1`, 'recent backup');
        f.files.set(`${f.log.path}.2`, 'oldest backup');
        const before = new Map(f.files);
        const inspect = f.filesystem.lstatSync;
        f.filesystem.lstatSync = ((path: string) =>
            path === `${f.log.path}.2`
                ? unsafe
                : inspect(path)) as typeof inspect;

        f.log.write('startup');

        assert.match(f.log.getSnapshot().failure, /logging failed/);
        assert.deepEqual(f.files, before);
    }
});

test('logging warns once per failure period and recovers without changing operation outcomes', async () => {
    const f = fixture();
    f.fail();
    f.log.write('startup');
    assert.equal(f.warnings.length, 1);
    f.log.write('config.load');
    assert.equal(f.warnings.length, 1);
    f.recover();
    assert.equal(await f.log.operation('config.save', {}, async () => 42), 42);
    assert.equal(f.log.getSnapshot().failure, '');
    f.fail();
    f.log.write('shutdown');
    assert.equal(f.warnings.length, 2);
});

test('unrecognized events do not create log entries or update the public snapshot', () => {
    const f = fixture();
    const before = f.log.getSnapshot();
    f.log.write('unexpected raw event' as Parameters<TuiLog['write']>[0]);
    assert.deepEqual(f.log.getSnapshot(), before);
    assert.equal(f.files.get(f.log.path), '');
});

test('initialization creates missing log directories and a private startup log', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-log-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const log = initializeTuiLog(join(root, 'state', 'logs'));
    assert.equal((await stat(log.path)).mode & 0o777, 0o600);
    const entry = JSON.parse(await readFile(log.path, 'utf8'));
    assert.equal(entry.event, 'startup');
    assert.equal(entry.status, 'start');
    assert.equal(log.getSnapshot().failure, '');
});

test('initialization fails when storage accepts an empty file but rejects the first log record', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-log-full-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const write = hostFs.writeFileSync;
    const fault = t.mock.method(
        hostFs,
        'writeFileSync',
        (
            path: fs.PathOrFileDescriptor,
            data: string | NodeJS.ArrayBufferView,
            options?: fs.WriteFileOptions,
        ) => {
            if (Buffer.byteLength(data) > 0)
                throw Object.assign(new Error('fixture storage full'), {
                    code: 'ENOSPC',
                });
            return write(path, data, options);
        },
    );
    syncBuiltinESMExports();
    try {
        assert.throws(
            () => initializeTuiLog(root),
            /Cannot initialize TUI logging/,
        );
    } finally {
        fault.mock.restore();
        syncBuiltinESMExports();
    }
});
