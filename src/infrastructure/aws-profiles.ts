import { rethrowIfAborted } from './cancellation.js';
import { execFile } from 'node:child_process';
import { opendir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isProfileName } from '../domain/settings.js';

const exec = promisify(execFile);

export type {
    AwsProfileInfo,
    EcrRegistry,
    DiscoveredProfile,
    ProfileDiscovery,
} from '../domain/aws-profiles.js';
import type {
    AwsProfileInfo,
    EcrRegistry,
    DiscoveredProfile,
    ProfileDiscovery,
} from '../domain/aws-profiles.js';

const registryPattern =
    /\b(\d{12})\.dkr\.ecr\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazonaws\.com\b/g;

function sectionProfile(
    section: string,
    profiles: Map<string, AwsProfileInfo>,
): AwsProfileInfo | undefined {
    const name =
        section === 'default'
            ? 'default'
            : /^profile\s+(.+)$/.exec(section)?.[1]?.trim();
    if (!(name && isProfileName(name))) return undefined;
    const current = profiles.get(name) ?? { name };
    profiles.set(current.name, current);
    return current;
}

function applyConfigValue(
    current: AwsProfileInfo,
    key: string,
    value: string,
): void {
    if (key === 'region' && /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(value))
        current.region = value;
    else if (key === 'sso_account_id' && /^\d{12}$/.test(value))
        current.account = value;
    else if (key === 'role_arn' && !current.account) {
        const account = /^arn:aws[\w-]*:iam::(\d{12}):/.exec(value)?.[1];
        if (account) current.account = account;
    }
}

/** Parses AWS config INI data without evaluating it. */
export function parseAwsConfig(text: string): Map<string, AwsProfileInfo> {
    const profiles = new Map<string, AwsProfileInfo>();
    let current: AwsProfileInfo | undefined;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const section = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
        if (section) {
            current = sectionProfile(section[1], profiles);
            continue;
        }
        if (!current) continue;
        const pair = /^([A-Za-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!pair) continue;
        applyConfigValue(current, pair[1], pair[2]);
    }
    return profiles;
}

export function awsConfigPath(env = process.env, home = homedir()): string {
    return env.AWS_CONFIG_FILE?.trim() || join(home, '.aws', 'config');
}

async function listProfiles(signal?: AbortSignal): Promise<string[]> {
    const { stdout } = await exec('aws', ['configure', 'list-profiles'], {
        signal,
        timeout: 12000,
        maxBuffer: 256 * 1024,
        env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' },
    });
    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(isProfileName);
}

const skipped = new Set(['node_modules', '.git', 'repositories']);
async function registriesInFile(path: string, bytes: number) {
    try {
        if ((await stat(path)).size > bytes) return [];
        const text = await readFile(path, 'utf8');
        return [...text.matchAll(registryPattern)].map((match) => ({
            host: match[0],
            account: match[1],
            region: match[2],
        }));
    } catch {
        return [];
    }
}

/** Finds ECR registries referenced by the project's Compose and builder files. */
export async function scanRegistries(
    projectDirectory: string,
    signal?: AbortSignal,
    limits = { files: 5000, bytes: 1024 * 1024 },
): Promise<{ host: string; account: string; region: string }[]> {
    const found = new Map<
        string,
        { host: string; account: string; region: string }
    >();
    let files = 0;
    const inspectFile = async (isFile: boolean, path: string) => {
        if (!isFile || files >= limits.files) return;
        files++;
        for (const registry of await registriesInFile(path, limits.bytes))
            found.set(registry.host, registry);
    };
    const walk = async (directory: string, depth: number): Promise<void> => {
        signal?.throwIfAborted();
        if (depth > 8) return;
        if (files >= limits.files) return;
        let handle;
        try {
            handle = await opendir(directory);
        } catch {
            return;
        }
        for await (const entry of handle) {
            signal?.throwIfAborted();
            const path = join(directory, entry.name);
            if (!entry.isDirectory()) {
                await inspectFile(entry.isFile(), path);
                continue;
            }
            if (skipped.has(entry.name)) continue;
            await walk(path, depth + 1);
        }
    };
    for (const root of ['services', join('local', 'builders')])
        await walk(join(projectDirectory, root), 0);
    return [...found.values()].sort((a, b) => a.host.localeCompare(b.host));
}

export function matchProfiles(
    profiles: readonly AwsProfileInfo[],
    registries: readonly { host: string; account: string; region: string }[],
    primary: string,
): Omit<ProfileDiscovery, 'warnings'> {
    const matched: EcrRegistry[] = registries.map((registry) => ({
        ...registry,
        profiles: profiles
            .filter(
                (profile) =>
                    profile.account === registry.account &&
                    profile.region === registry.region,
            )
            .map((profile) => profile.name),
    }));
    const recommended = [
        ...new Set(
            matched.flatMap((registry) =>
                registry.profiles.includes(primary)
                    ? [primary]
                    : registry.profiles.slice(0, 1),
            ),
        ),
    ];
    return {
        registries: matched,
        unmatched: matched
            .filter((registry) => !registry.profiles.length)
            .map((registry) => registry.host),
        recommended,
        profiles: profiles.map((profile) => ({
            ...profile,
            required: recommended.includes(profile.name),
            registries: matched
                .filter((registry) => registry.profiles.includes(profile.name))
                .map((registry) => registry.host),
        })),
    };
}

export interface DiscoveryDependencies {
    listProfiles(signal?: AbortSignal): Promise<string[]>;
    readConfig(): Promise<string>;
    scanRegistries(
        directory: string,
        signal?: AbortSignal,
    ): ReturnType<typeof scanRegistries>;
}
const defaultDependencies: DiscoveryDependencies = {
    listProfiles,
    readConfig: () => readFile(awsConfigPath(), 'utf8'),
    scanRegistries,
};

export async function discoverAwsProfiles(
    options: {
        projectDirectory?: string;
        primary: string;
        signal?: AbortSignal;
    },
    dependencies: DiscoveryDependencies = defaultDependencies,
): Promise<ProfileDiscovery> {
    const warnings: string[] = [];
    let details = new Map<string, AwsProfileInfo>();
    try {
        details = parseAwsConfig(await dependencies.readConfig());
    } catch {
        warnings.push('AWS config file could not be read.');
    }
    let names: string[];
    try {
        names = await dependencies.listProfiles(options.signal);
    } catch (error) {
        rethrowIfAborted(options.signal, error);
        warnings.push(
            'aws configure list-profiles failed; showing profiles from the AWS config file.',
        );
        names = [...details.keys()];
    }
    const profiles = [...new Set(names)].map(
        (name) => details.get(name) ?? { name },
    );
    const registries = options.projectDirectory
        ? await dependencies.scanRegistries(
              options.projectDirectory,
              options.signal,
          )
        : [];
    return {
        ...matchProfiles(profiles, registries, options.primary),
        warnings,
    };
}

/** Configured profiles win; otherwise detected ones; otherwise the primary. */
export function effectiveEcrProfiles(
    configured: readonly string[] | undefined,
    discovery: Pick<ProfileDiscovery, 'recommended'> | undefined,
    primary: string,
): string[] {
    if (configured?.length) return [...configured];
    if (discovery?.recommended.length) return [...discovery.recommended];
    return [primary];
}

export interface EcrLoginPlan {
    profiles: string[];
    source: 'configured' | 'detected' | 'primary';
    unmatched: string[];
}
/** Decides which profiles registry login uses, detecting them when unset. */
export async function planEcrLogin(
    options: {
        configured?: readonly string[];
        primary: string;
        projectDirectory?: string;
        signal?: AbortSignal;
    },
    discover: typeof discoverAwsProfiles = discoverAwsProfiles,
): Promise<EcrLoginPlan> {
    if (options.configured?.length)
        return {
            profiles: [...options.configured],
            source: 'configured',
            unmatched: [],
        };
    let discovery: ProfileDiscovery | undefined;
    try {
        discovery = await discover({
            projectDirectory: options.projectDirectory,
            primary: options.primary,
            signal: options.signal,
        });
    } catch (error) {
        rethrowIfAborted(options.signal, error);
    }
    const profiles = effectiveEcrProfiles(
        undefined,
        discovery,
        options.primary,
    );
    return {
        profiles,
        source: discovery?.recommended.length ? 'detected' : 'primary',
        unmatched: discovery?.unmatched ?? [],
    };
}
