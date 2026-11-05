import { access, lstat, opendir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Dir } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const projectRepositoryUrl =
    'git@github.com:companieshouse/docker-chs-development.git';

const remotePattern =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)companieshouse\/docker-chs-development(?:\.git)?\/?$/i;
export function isProjectRemote(url: string): boolean {
    return remotePattern.test(url.trim());
}

/** Reads `remote.origin.url` from a Git config file's text. */
export function parseOrigin(config: string): string | undefined {
    let inOrigin = false;
    for (const rawLine of config.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const section = /^\[\s*([^\]\s]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
        if (section) {
            inOrigin =
                section[1].toLowerCase() === 'remote' &&
                section[2] === 'origin';
            continue;
        }
        const url = /^url\s*=\s*(.+)$/i.exec(line);
        if (inOrigin && url) return url[1].trim().replace(/^"(.*)"$/, '$1');
    }
    return undefined;
}

/**
 * Finds the Git config for a working tree without running git. Supports
 * `.git` files used by worktrees and submodules.
 */
export async function gitConfigPath(
    directory: string,
): Promise<string | undefined> {
    const dotGit = join(directory, '.git');
    let info;
    try {
        info = await lstat(dotGit);
    } catch {
        return undefined;
    }
    if (info.isDirectory()) return join(dotGit, 'config');
    if (!info.isFile() || info.size > 4096) return undefined;
    const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8'));
    if (!pointer) return undefined;
    const gitDirectory = resolve(directory, pointer[1].trim());
    try {
        const common = (
            await readFile(join(gitDirectory, 'commondir'), 'utf8')
        ).trim();
        return join(resolve(gitDirectory, common), 'config');
    } catch {
        return join(gitDirectory, 'config');
    }
}

export async function readGitOrigin(
    directory: string,
): Promise<string | undefined> {
    try {
        const path = await gitConfigPath(directory);
        if (!path || (await stat(path)).size > 256 * 1024) return undefined;
        return parseOrigin(await readFile(path, 'utf8'));
    } catch {
        return undefined;
    }
}

// Directories that never contain checkouts, are huge, or are protected by
// macOS privacy prompts. Hidden directories are skipped separately.
const skippedNames = new Set([
    'node_modules',
    'Library',
    'Applications',
    'Movies',
    'Music',
    'Pictures',
    'Photos',
    'vendor',
    'target',
    'dist',
    'build',
    'venv',
    '__pycache__',
]);

export interface ProjectSearchOptions {
    signal?: AbortSignal;
    maxDepth?: number;
    maxDirectories?: number;
    onFound?(directory: string): void;
    onProgress?(visited: number): void;
}
export interface ProjectSearchResult {
    found: string[];
    visited: number;
    truncated: boolean;
}

/**
 * Breadth-first search for docker-chs-development clones. Symlinks are not
 * followed and matches are not searched further.
 */
async function listSubdirectories(
    directory: string,
    handle: Dir,
): Promise<string[]> {
    const children: string[] = [];
    try {
        for await (const entry of handle) {
            if (
                entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                !skippedNames.has(entry.name)
            )
                children.push(join(directory, entry.name));
        }
    } catch {
        // Directories that disappear or deny listing are skipped.
    }
    return children;
}

function matchesProject(origin: string | undefined): boolean {
    return origin !== undefined && isProjectRemote(origin);
}

async function listChildren(
    directory: string,
    depth: number,
    maxDepth: number,
): Promise<string[]> {
    if (depth === maxDepth) return [];
    let handle;
    try {
        handle = await opendir(directory);
    } catch {
        return [];
    }
    return listSubdirectories(directory, handle);
}

async function inspectSearchDirectory(
    directory: string,
    depth: number,
    maxDepth: number,
    onFound: (match: string) => void,
) {
    const origin = await readGitOrigin(directory);
    if (matchesProject(origin)) {
        onFound(directory);
        return [];
    }
    return listChildren(directory, depth, maxDepth);
}

export async function searchProjects(
    root: string,
    {
        signal,
        maxDepth = 5,
        maxDirectories = 100_000,
        onFound,
        onProgress,
    }: ProjectSearchOptions = {},
): Promise<ProjectSearchResult> {
    const notifyFound = onFound ?? (() => {});
    const notifyProgress = onProgress ?? (() => {});
    const found: string[] = [];
    let queue: string[] = [root];
    let visited = 0;
    let truncated = false;
    const record = (match: string) => {
        found.push(match);
        notifyFound(match);
    };
    const progress = () => {
        visited++;
        if (visited % 250 === 0) notifyProgress(visited);
    };
    const scanLevel = async (directories: string[], depth: number) => {
        const next: string[] = [];
        for (const directory of directories) {
            signal?.throwIfAborted();
            if (visited >= maxDirectories) {
                truncated = true;
                break;
            }
            progress();
            next.push(
                ...(await inspectSearchDirectory(
                    directory,
                    depth,
                    maxDepth,
                    record,
                )),
            );
        }
        return next;
    };
    for (let depth = 0; depth <= maxDepth && queue.length; depth++) {
        queue = await scanLevel(queue, depth);
        if (truncated) break;
    }
    notifyProgress(visited);
    return { found, visited, truncated };
}

export async function defaultCloneDestination(
    home = homedir(),
): Promise<string> {
    const workspace = join(home, 'Workspace');
    try {
        if ((await stat(workspace)).isDirectory())
            return join(workspace, 'docker-chs-development');
    } catch {
        // Fall back to the home directory.
    }
    return join(home, 'docker-chs-development');
}

/** Returns an error message, or undefined when the path can be cloned into. */
export async function cloneDestinationError(
    destination: string,
): Promise<string | undefined> {
    if (!isAbsolute(destination))
        return 'Enter an absolute path or one starting with ~/.';
    if (!basename(destination)) return 'Enter a directory name to create.';
    try {
        await lstat(destination);
        return 'That path already exists. Choose a new directory.';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            return 'That path cannot be checked.';
    }
    try {
        const parent = dirname(destination);
        if (!(await stat(parent)).isDirectory())
            return 'The parent path is not a directory.';
        await access(parent, constants.W_OK | constants.X_OK);
    } catch {
        return 'The parent directory must exist and be writable.';
    }
    return undefined;
}
