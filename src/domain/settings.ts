import { parseAutoLogin, type AutoLoginMode } from './auto-login.js';

export const settingKeys = [
    'project',
    'awsProfile',
    'ecrProfiles',
    'usageCache',
    'loginAction',
    'autoLogin',
] as const;
export type SettingKey = (typeof settingKeys)[number];
export type SettingSource = 'env' | 'file' | 'default';
/** What Ctrl+L does; unset behaves like ask. */
export const loginChoices = ['ask', 'aws', 'registry'] as const;
export type LoginChoice = (typeof loginChoices)[number];
export function parseLoginChoice(value: string): LoginChoice | undefined {
    const normalized = value.trim().toLowerCase();
    if (['docker', 'ecr', 'aws+docker'].includes(normalized)) return 'registry';
    return (loginChoices as readonly string[]).includes(normalized)
        ? (normalized as LoginChoice)
        : undefined;
}

export interface FileSettings {
    project?: string;
    awsProfile?: string;
    ecrProfiles?: string[];
    usageCache?: boolean;
    loginAction?: LoginChoice;
    autoLogin?: AutoLoginMode;
}
export interface SettingValues {
    project?: string;
    awsProfile: string;
    ecrProfiles?: string[];
    usageCache: boolean;
    loginAction?: LoginChoice;
    autoLogin: AutoLoginMode;
}
export interface ResolvedSetting<T> {
    value: T;
    source: SettingSource;
    /** The environment variable providing the value, when source is env. */
    environment?: string;
    /** The file value, reported even when an environment variable wins. */
    file?: T;
}
export type ResolvedSettings = {
    [K in SettingKey]: ResolvedSetting<SettingValues[K]>;
};

/** Settings read once at startup; changing them needs a restart. */
export const restartSettings: readonly SettingKey[] = ['project'];

export const settingLabels: Record<SettingKey, string> = {
    project: 'Project directory',
    awsProfile: 'AWS profile',
    ecrProfiles: 'ECR login profiles',
    usageCache: 'Usage cache (learned lazy)',
    loginAction: 'Ctrl+L login',
    autoLogin: 'Automatic login',
};

export const settingEnvironment: Record<SettingKey, readonly string[]> = {
    project: ['CHS_DEV_PROJECT'],
    awsProfile: ['AWS_PROFILE', 'AWS_DEFAULT_PROFILE'],
    ecrProfiles: ['CHS_DEV_ECR_PROFILES'],
    usageCache: ['CHS_DEV_USAGE_CACHE'],
    loginAction: ['CHS_DEV_LOGIN'],
    autoLogin: ['CHS_DEV_AUTO_LOGIN'],
};

const profilePattern = /^[A-Za-z0-9_.+=,@-]{1,128}$/;
export function isProfileName(value: unknown): value is string {
    return typeof value === 'string' && profilePattern.test(value);
}
export function parseBoolean(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}
export function parseProfileList(value: string): string[] | undefined {
    const profiles = [
        ...new Set(
            value
                .split(/[\s,]+/)
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
    return profiles.length && profiles.every(isProfileName)
        ? profiles
        : undefined;
}

function resolve<T>(
    key: SettingKey,
    file: T | undefined,
    env: NodeJS.ProcessEnv,
    parse: (value: string) => T | undefined,
    fallback: T,
): ResolvedSetting<T> {
    for (const name of settingEnvironment[key]) {
        const raw = env[name]?.trim();
        if (!raw) continue;
        const value = parse(raw);
        if (value !== undefined)
            return { value, source: 'env', environment: name, file };
    }
    if (file !== undefined) return { value: file, source: 'file', file };
    return { value: fallback, source: 'default' };
}

/** Environment variables override the file, which overrides defaults. */
export function resolveSettings(
    file: FileSettings,
    env: NodeJS.ProcessEnv,
): ResolvedSettings {
    const text = (value: string) => value;
    return {
        project: resolve<string | undefined>(
            'project',
            file.project,
            env,
            text,
            undefined,
        ),
        awsProfile: resolve(
            'awsProfile',
            file.awsProfile,
            env,
            (value) => value,
            'default',
        ),
        ecrProfiles: resolve<string[] | undefined>(
            'ecrProfiles',
            file.ecrProfiles,
            env,
            parseProfileList,
            undefined,
        ),
        usageCache: resolve(
            'usageCache',
            file.usageCache,
            env,
            parseBoolean,
            false,
        ),
        loginAction: resolve<LoginChoice | undefined>(
            'loginAction',
            file.loginAction,
            env,
            parseLoginChoice,
            undefined,
        ),
        autoLogin: resolve(
            'autoLogin',
            file.autoLogin,
            env,
            parseAutoLogin,
            'needed',
        ),
    };
}

export function retiredEnvironmentWarnings(env: NodeJS.ProcessEnv): string[] {
    const warnings = [
        'CHS_DEV_RUNTIME',
        'CHS_DEV_ORCHESTRATOR',
        'CHS_DEV_APPLE_CLI',
    ]
        .filter((name) => env[name]?.trim())
        .map(
            (name) =>
                `${name} is retired and ignored; chs-dev always uses Docker Compose. Remove it from your startup environment.`,
        );
    if (env.CHS_DEV_AUTO_APPLY?.trim())
        warnings.push(
            'CHS_DEV_AUTO_APPLY is retired and ignored; saved changes wait for explicit Apply or Start. Remove it from your startup environment.',
        );
    return warnings;
}

export function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export interface SettingsSnapshot {
    path: string;
    resolved: ResolvedSettings;
    /** Values in effect since startup, used by restart-only settings. */
    startup: ResolvedSettings;
    errors: readonly string[];
    warnings: readonly string[];
    restartPending: readonly SettingKey[];
}
