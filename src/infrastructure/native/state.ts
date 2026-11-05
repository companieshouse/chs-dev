import { createHmac, randomBytes } from 'node:crypto';
import {
    mkdir,
    readFile,
    writeFile,
    appendFile,
    rename,
    stat,
    readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { ServiceSpec } from '../../domain/orchestration.js';
export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
            .join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
export class NativeState {
    private key?: Buffer;
    constructor(readonly directory: string) {}
    async initialize() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const keyPath = join(this.directory, 'fingerprint.key');
        try {
            await writeFile(keyPath, randomBytes(32), {
                flag: 'wx',
                mode: 0o600,
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        this.key = await readFile(keyPath);
        if (this.key.length !== 32)
            throw new Error('Invalid native fingerprint key');
    }
    digest(value: unknown) {
        if (!this.key) throw new Error('Native state not initialized');
        return createHmac('sha256', this.key)
            .update(canonical(value))
            .digest('hex');
    }
    async fingerprint(spec: ServiceSpec) {
        const files: Record<string, string> = {};
        for (const file of spec.fileInputs ?? [])
            files[file] = this.digest(
                (await readFile(file)).toString('base64'),
            );
        for (const mount of spec.mounts)
            if (
                mount.type === 'bind' &&
                mount.readOnly &&
                mount.source &&
                !mount.daemonSource
            ) {
                if ((await stat(mount.source)).isFile())
                    files[mount.target] = this.digest(
                        (await readFile(mount.source)).toString('base64'),
                    );
            }
        await this.fingerprintScripts(spec, files);
        const { fingerprint, source, imageReference, ...effective } = spec;
        return this.digest({ effective, files });
    }
    private async fingerprintScripts(
        spec: ServiceSpec,
        files: Record<string, string>,
    ) {
        if (!/^execute-.*-scripts$/.test(spec.name)) return;
        const scripts = spec.mounts.find(
            (m) => m.target === '/app/scripts/' || m.target === '/app/scripts',
        );
        const suffix = `.${spec.environment.SCRIPT_SUFFIX}.${spec.environment.SCRIPT_EXTENSION ?? 'sh'}`;
        const visit = async (directory: string): Promise<void> => {
            for (const entry of (
                await readdir(directory, { withFileTypes: true })
            ).sort((a, b) => a.name.localeCompare(b.name))) {
                const file = join(directory, entry.name);
                if (entry.isDirectory()) await visit(file);
                else if (entry.isFile() && entry.name.endsWith(suffix))
                    files[file] = this.digest(
                        (await readFile(file)).toString('base64'),
                    );
            }
        };
        if (scripts?.source) await visit(scripts.source);
    }
    async record(
        operation: string,
        action: string,
        service: string,
        outcome: string,
        id?: string,
    ) {
        await appendFile(
            join(this.directory, 'journal.jsonl'),
            JSON.stringify({
                time: new Date().toISOString(),
                operation,
                action,
                service,
                outcome,
                id,
            }) + '\n',
            { mode: 0o600 },
        );
    }
    async volumes(service: string): Promise<Record<string, string>> {
        try {
            return JSON.parse(
                await readFile(
                    join(this.directory, `${service}.volumes.json`),
                    'utf8',
                ),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
            throw error;
        }
    }
    async saveVolumes(service: string, volumes: Record<string, string>) {
        const file = join(this.directory, `${service}.volumes.json`);
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(volumes), { mode: 0o600 });
        await rename(tmp, file);
    }
}
