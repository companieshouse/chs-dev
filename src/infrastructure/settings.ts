import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Document, parseDocument } from 'yaml';
import { autoLoginModes } from '../domain/auto-login.js';
import {
    isProfileName,
    loginChoices,
    resolveSettings,
    restartSettings,
    sameValue,
    type FileSettings,
    type ResolvedSettings,
    type SettingKey,
    type SettingValues,
} from '../domain/settings.js';

const paths: Record<SettingKey, readonly string[]> = {
    project: ['project'],
    runtime: ['runtime'],
    orchestrator: ['orchestrator'],
    awsProfile: ['aws', 'profile'],
    ecrProfiles: ['aws', 'ecrProfiles'],
    autoApply: ['autoApply'],
    usageCache: ['usageCache'],
    loginAction: ['login', 'action'],
    autoLogin: ['login', 'auto'],
};

function xdgDirectory(
    variable: string,
    fallback: string,
    env: NodeJS.ProcessEnv,
    home: string,
) {
    const value = env[variable]?.trim();
    // The XDG specification requires absolute paths; relative values are ignored.
    return value && isAbsolute(value) ? value : join(home, fallback);
}
export function settingsPath(env = process.env, home = homedir()): string {
    return join(
        xdgDirectory('XDG_CONFIG_HOME', '.config', env, home),
        'chs-dev',
        'tui.yaml',
    );
}
export function stateDirectory(env = process.env, home = homedir()): string {
    return join(
        xdgDirectory('XDG_STATE_HOME', join('.local', 'state'), env, home),
        'chs-dev',
    );
}
/**
 * Per-project TUI state (log, lock, prepared Compose files). Kept outside the
 * project so the checkout is only read, never used for chs-dev's own files.
 */
export function projectStateDirectory(
    directory: string,
    base = stateDirectory(),
): string {
    let real: string;
    try {
        real = realpathSync(directory);
    } catch {
        real = resolve(directory);
    }
    const name =
        basename(real)
            .toLowerCase()
            .replace(/[^a-z0-9_.-]/g, '') || 'project';
    const hash = createHash('sha256').update(real).digest('hex').slice(0, 12);
    return join(base, 'projects', `${name}-${hash}`);
}
export function expandHome(value: string, home = homedir()): string {
    if (value === '~') return home;
    if (value.startsWith('~/')) return join(home, value.slice(2));
    return value;
}

type SettingCheck = { value: unknown } | { error: string };

const settingValidators: Record<
    SettingKey,
    (value: unknown, home: string) => SettingCheck
> = {
    project: (value, home) => {
        if (typeof value !== 'string' || !value.trim())
            return { error: 'must be a path' };
        const path = expandHome(value.trim(), home);
        return isAbsolute(path)
            ? { value: path }
            : { error: 'must be an absolute path or start with ~/' };
    },
    orchestrator: (value) =>
        value === 'compose' || value === 'native'
            ? { value }
            : { error: 'must be compose or native' },
    runtime: (value) =>
        typeof value === 'string' &&
        /^[a-z][a-z0-9-]{0,31}$/i.test(value.trim())
            ? { value: value.trim().toLowerCase() }
            : { error: 'must be a runtime identifier' },
    awsProfile: (value) =>
        isProfileName(value)
            ? { value }
            : { error: 'must be an AWS profile name' },
    ecrProfiles: (value) =>
        Array.isArray(value) && value.length > 0 && value.every(isProfileName)
            ? { value: [...new Set(value)] }
            : { error: 'must be a non-empty list of AWS profile names' },
    autoApply: (value) =>
        typeof value === 'boolean'
            ? { value }
            : { error: 'must be true or false' },
    usageCache: (value) =>
        typeof value === 'boolean'
            ? { value }
            : { error: 'must be true or false' },
    loginAction: (value) =>
        typeof value === 'string' &&
        (loginChoices as readonly string[]).includes(value)
            ? { value }
            : { error: `must be one of ${loginChoices.join(', ')}` },
    autoLogin: (value) =>
        typeof value === 'string' &&
        (autoLoginModes as readonly string[]).includes(value)
            ? { value }
            : { error: `must be one of ${autoLoginModes.join(', ')}` },
};

/** Returns the normalized value, or a message describing why it is invalid. */
export function validateSetting<K extends SettingKey>(
    key: K,
    value: unknown,
    home = homedir(),
): { value: SettingValues[K] } | { error: string } {
    return settingValidators[key](value, home) as
        | {
              value: SettingValues[K];
          }
        | { error: string };
}

export interface SettingsFile {
    values: FileSettings;
    raw: string | null;
    errors: string[];
}
async function readRaw(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}
function settingValue(value: unknown) {
    return value && typeof value === 'object' && 'toJSON' in value
        ? (value as { toJSON(): unknown }).toJSON()
        : value;
}

export function parseSettings(
    raw: string | null,
    home = homedir(),
): SettingsFile {
    if (raw === null) return { values: {}, raw, errors: [] };
    const document = parseDocument(raw);
    if (document.errors.length)
        return {
            values: {},
            raw,
            errors: ['Settings file is not valid YAML; defaults are in use.'],
        };
    const values: FileSettings = {};
    const errors: string[] = [];
    for (const key of Object.keys(paths) as SettingKey[]) {
        const value: unknown = document.getIn(paths[key]);
        if (value === undefined || value === null) continue;
        const plain = settingValue(value);
        const checked = validateSetting(key, plain, home);
        if ('error' in checked)
            errors.push(`${paths[key].join('.')} ${checked.error}; ignored.`);
        else (values as Record<string, unknown>)[key] = checked.value;
    }
    return { values, raw, errors };
}
export async function readSettingsFile(
    path: string,
    home = homedir(),
): Promise<SettingsFile> {
    try {
        return parseSettings(await readRaw(path), home);
    } catch {
        return {
            values: {},
            raw: null,
            errors: ['Settings file cannot be read; defaults are in use.'],
        };
    }
}

function normalizedSetting(
    key: SettingKey,
    value: unknown,
    home: string,
): unknown {
    if (value === undefined) return undefined;
    const checked = validateSetting(key, value, home);
    if ('error' in checked)
        throw new Error(`Invalid ${paths[key].join('.')}: ${checked.error}.`);
    return checked.value;
}

function removeSettingValue(document: Document, key: SettingKey): void {
    document.deleteIn(paths[key]);
    const parent = paths[key].slice(0, -1);
    const container: unknown = parent.length
        ? document.getIn(parent)
        : undefined;
    if (
        parent.length &&
        container &&
        typeof container === 'object' &&
        'items' in container &&
        Array.isArray((container as { items: unknown[] }).items) &&
        (container as { items: unknown[] }).items.length === 0
    )
        document.deleteIn(parent);
}

function prepareDocument(
    original: string | null,
    path: string,
    key: SettingKey,
    normalized: unknown,
): Document {
    const document =
        original === null
            ? new Document({ version: 1 })
            : parseDocument(original);
    if (document.errors.length)
        throw new Error(
            `Cannot edit invalid settings file ${path}. Fix or remove it first.`,
        );
    if (document.contents === null) document.contents = document.createNode({});
    if (!document.has('version')) document.set('version', 1);
    if (normalized === undefined) removeSettingValue(document, key);
    else document.setIn(paths[key], normalized);
    if (key === 'runtime' && normalized === 'apple')
        document.setIn(paths.orchestrator, 'native');
    return document;
}

/**
 * Updates one key while preserving comments and unknown keys. The write is
 * atomic and refuses to overwrite a file changed since it was read.
 */
export async function writeSetting<K extends SettingKey>(
    path: string,
    key: K,
    value: SettingValues[K] | undefined,
    expected: string | null,
    home = homedir(),
): Promise<string> {
    const normalized = normalizedSetting(key, value, home);
    const original = await readRaw(path);
    if (original !== expected)
        throw new Error(
            'Settings changed outside this editor. Refresh and review the latest values.',
        );
    const next = prepareDocument(original, path, key, normalized).toString();
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.tui.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
        if ((await readRaw(path)) !== original)
            throw new Error(
                'Settings changed while saving. Refresh and review the latest values.',
            );
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true });
    }
    return next;
}

export type { SettingsSnapshot } from '../domain/settings.js';
import type { SettingsSnapshot } from '../domain/settings.js';

export class SettingsStore {
    private snapshot: SettingsSnapshot;
    private raw: string | null;
    private listeners = new Set<() => void>();
    private saving = Promise.resolve();
    constructor(
        readonly path: string,
        file: SettingsFile,
        private readonly env: NodeJS.ProcessEnv = process.env,
        private readonly home = homedir(),
    ) {
        this.raw = file.raw;
        const resolved = resolveSettings(file.values, env);
        this.snapshot = {
            path,
            resolved,
            startup: resolved,
            errors: file.errors,
            restartPending: [],
        };
    }
    static async load(
        path = settingsPath(),
        env: NodeJS.ProcessEnv = process.env,
        home = homedir(),
    ) {
        return new SettingsStore(
            path,
            await readSettingsFile(path, home),
            env,
            home,
        );
    }
    getSnapshot = (): SettingsSnapshot => this.snapshot;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    preview<K extends SettingKey>(
        key: K,
        value: SettingValues[K] | undefined,
    ): ResolvedSettings {
        const checked =
            value === undefined
                ? undefined
                : validateSetting(key, value, this.home);
        if (checked && 'error' in checked) throw new Error(checked.error);
        const values = { ...parseSettings(this.raw, this.home).values };
        (values as Record<string, unknown>)[key] = checked?.value;
        if (key === 'runtime' && value === 'apple')
            values.orchestrator = 'native';
        return resolveSettings(values, this.env);
    }
    activate() {
        this.snapshot = {
            ...this.snapshot,
            startup: this.snapshot.resolved,
            restartPending: [],
        };
        for (const listener of this.listeners) listener();
    }
    async refresh() {
        const work = this.saving.then(async () => {
            const file = await readSettingsFile(this.path, this.home);
            if (file.raw === this.raw) return;
            this.raw = file.raw;
            const resolved = resolveSettings(file.values, this.env);
            this.snapshot = {
                ...this.snapshot,
                resolved,
                errors: file.errors,
                restartPending: restartSettings.filter(
                    (key) =>
                        !sameValue(
                            resolved[key].value,
                            this.snapshot.startup[key].value,
                        ),
                ),
            };
            for (const listener of this.listeners) listener();
        });
        this.saving = work.catch(() => {});
        return work;
    }
    /** Saves one value; `undefined` removes it so the default applies. */
    save<K extends SettingKey>(
        key: K,
        value: SettingValues[K] | undefined,
    ): Promise<void> {
        const work = this.saving.then(async () => {
            this.raw = await writeSetting(
                this.path,
                key,
                value,
                this.raw,
                this.home,
            );
            const file = parseSettings(this.raw, this.home);
            const resolved = resolveSettings(file.values, this.env);
            this.snapshot = {
                ...this.snapshot,
                resolved,
                errors: file.errors,
                restartPending: restartSettings.filter(
                    (name) =>
                        !sameValue(
                            resolved[name].value,
                            this.snapshot.startup[name].value,
                        ),
                ),
            };
            for (const listener of this.listeners) listener();
        });
        this.saving = work.catch(() => undefined);
        return work;
    }
}

let store: SettingsStore | undefined;
export async function initializeSettings(
    path = settingsPath(),
): Promise<SettingsStore> {
    store = await SettingsStore.load(path);
    return store;
}
export function settingsStore(): SettingsStore | undefined {
    return store;
}
/** Current values, including edits made since startup. */
export function currentSettings(): ResolvedSettings {
    return store?.getSnapshot().resolved ?? resolveSettings({}, process.env);
}
/** Values that were in effect at startup. */
export function activeSettings(): ResolvedSettings {
    return store?.getSnapshot().startup ?? resolveSettings({}, process.env);
}
