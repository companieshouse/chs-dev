import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, open, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { flock } from 'fs-ext';
import { optionalJson } from './native/state-files.js';
import type {
    OperationRecord,
    OperationStore,
} from '../application/operations.js';
import type { LiveIntent } from '../application/live-controller.js';
import type { Scope } from '../protocol/types.js';

const lock = (fd: number, flag: 'exnb' | 'un') =>
    new Promise<void>((resolve, reject) => {
        flock(fd, flag, (error) => (error ? reject(error) : resolve()));
    });
/** Kernel ownership survives stale files and is released automatically on process death. */
export async function exclusiveLease(
    path: string,
): Promise<() => Promise<void>> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const file = await open(path, 'a+', 0o600);
    try {
        await lock(file.fd, 'exnb');
    } catch (error) {
        await file.close();
        throw new Error(
            `Another daemon or live session owns ${path}. Close it before taking over.`,
        );
    }
    // Never unlink this inode: another process may already have opened it to lock.
    return async () => {
        await lock(file.fd, 'un');
        await file.close();
    };
}
export interface DaemonIntent {
    version: 1;
    hostSession: string;
    scope: Scope;
    backend: string;
    intent?: LiveIntent;
    interrupted: boolean;
    switching?: boolean;
}
export class DaemonState implements OperationStore {
    private key!: Buffer;
    private serial: Promise<unknown> = Promise.resolve();
    constructor(readonly directory: string) {}
    async initialize() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = join(this.directory, 'requests.key');
        try {
            await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        this.key = await readFile(path);
        if (this.key.length !== 32)
            throw new Error('Invalid daemon request key.');
    }
    id = randomUUID;
    fingerprint(request: unknown) {
        return createHmac('sha256', this.key)
            .update(JSON.stringify(request))
            .digest('hex');
    }
    async read() {
        const saved = await optionalJson<{
            version: number;
            records: OperationRecord[];
        }>(join(this.directory, 'operations.json'));
        if (!saved) return [];
        if (saved.version !== 1 || !Array.isArray(saved.records))
            throw new Error(
                'Unsupported daemon operation history. Use the matching chs-dev version.',
            );
        return saved.records;
    }
    write(records: OperationRecord[]) {
        return this.durable('operations.json', { version: 1, records });
    }
    async readIntent() {
        const saved = await optionalJson<DaemonIntent>(
            join(this.directory, 'session.json'),
        );
        if (saved && saved.version !== 1)
            throw new Error(
                'Unsupported daemon session state. Use the matching chs-dev version.',
            );
        return saved;
    }
    writeIntent(intent: DaemonIntent) {
        return this.durable('session.json', intent);
    }
    private durable(name: string, value: unknown) {
        const contents = JSON.stringify(value);
        const result = this.serial.then(async () => {
            const path = join(this.directory, name),
                temporary = `${path}.${randomUUID()}.tmp`;
            const file = await open(temporary, 'wx', 0o600);
            try {
                await file.writeFile(contents);
                await file.sync();
            } finally {
                await file.close();
            }
            try {
                await rename(temporary, path);
                const directory = await open(this.directory, 'r');
                try {
                    await directory.sync();
                } finally {
                    await directory.close();
                }
            } finally {
                await rm(temporary, { force: true });
            }
        });
        this.serial = result.catch(() => {});
        return result;
    }
    async flush() {
        await this.serial;
    }
}
/** A new GUI login creates a new per-user launchd manager, while daemon restarts do not. */
export async function hostSessionIdentity(): Promise<string> {
    if (process.env.CHS_DEV_TEST_SESSION)
        return process.env.CHS_DEV_TEST_SESSION;
    if (process.platform === 'darwin') {
        try {
            const exec = promisify(execFile);
            const { stdout } = await exec('/bin/launchctl', ['managerpid'], {
                timeout: 3000,
            });
            const pid = stdout.trim();
            if (!/^\d+$/.test(pid)) throw new Error('No login manager');
            const started = await exec(
                '/bin/ps',
                ['-p', pid, '-o', 'lstart='],
                { timeout: 3000 },
            );
            const boot = await exec(
                '/usr/sbin/sysctl',
                ['-n', 'kern.boottime'],
                { timeout: 3000 },
            );
            const domain = await exec(
                '/bin/launchctl',
                ['print', `gui/${process.getuid!()}`],
                { timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
            );
            const asid = /^\s*asid\s*=\s*(\d+)\s*$/m.exec(domain.stdout)?.[1];
            if (!asid) throw new Error('No GUI login identity');
            return `${boot.stdout.trim()}:${asid}:${pid}:${started.stdout.trim()}`;
        } catch {
            /* Unknown session identity requires an explicit Start. */
        }
    }
    return `unverified:${randomUUID()}`;
}
