import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    cloneDestinationError,
    defaultCloneDestination,
    isProjectRemote,
    parseOrigin,
    readGitOrigin,
    searchProjects,
} from '../src/project/discovery.js';

async function repository(path: string, url: string) {
    await mkdir(join(path, '.git'), { recursive: true });
    await writeFile(
        join(path, '.git', 'config'),
        `[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:other/x.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    );
}

test('only companieshouse/docker-chs-development origins match', () => {
    for (const url of [
        'git@github.com:companieshouse/docker-chs-development.git',
        'git@github.com:companieshouse/docker-chs-development',
        'https://github.com/companieshouse/docker-chs-development.git',
        'https://token@github.com/CompaniesHouse/docker-chs-development/',
        'ssh://git@github.com/companieshouse/docker-chs-development.git',
    ])
        assert.equal(isProjectRemote(url), true, url);
    for (const url of [
        'git@github.com:someone/docker-chs-development.git',
        'git@github.com:companieshouse/docker-chs-development-old.git',
        'https://example.com/companieshouse/docker-chs-development.git',
    ])
        assert.equal(isProjectRemote(url), false, url);
    assert.equal(
        parseOrigin('[remote "origin"]\n  url = "git@github.com:a/b.git"\n'),
        'git@github.com:a/b.git',
    );
    assert.equal(parseOrigin('[remote "fork"]\nurl = x\n'), undefined);
});

test('search is breadth-first, bounded, skips hidden and heavy directories, and does not descend into matches', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-search-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const url = 'git@github.com:companieshouse/docker-chs-development.git';
    await repository(join(root, 'Workspace', 'docker-chs-development'), url);
    await repository(
        join(root, 'Workspace', 'docker-chs-development', 'nested'),
        url,
    );
    await repository(join(root, 'Workspace', 'renamed-clone'), url);
    await repository(
        join(root, 'Workspace', 'fork'),
        'git@github.com:me/x.git',
    );
    await repository(join(root, '.hidden', 'clone'), url);
    await repository(join(root, 'node_modules', 'clone'), url);
    await repository(join(root, 'Library', 'clone'), url);
    await repository(join(root, 'a', 'b', 'c', 'd', 'e', 'too-deep'), url);
    await symlink(join(root, 'Workspace'), join(root, 'linked'));

    // A worktree points at the main repository's common directory.
    const worktreeGit = join(root, 'main-repo', '.git', 'worktrees', 'wt');
    await repository(join(root, 'main-repo'), url);
    await mkdir(worktreeGit, { recursive: true });
    await writeFile(join(worktreeGit, 'commondir'), '../..\n');
    await mkdir(join(root, 'wt'));
    await writeFile(join(root, 'wt', '.git'), `gitdir: ${worktreeGit}\n`);
    assert.equal(await readGitOrigin(join(root, 'wt')), url);

    const found: string[] = [];
    const result = await searchProjects(root, {
        onFound: (directory) => found.push(directory),
    });
    assert.deepEqual(result.found, found);
    assert.deepEqual(
        [...found].sort(),
        [
            join(root, 'Workspace', 'docker-chs-development'),
            join(root, 'Workspace', 'renamed-clone'),
            join(root, 'main-repo'),
            join(root, 'wt'),
        ].sort(),
    );
    assert.equal(result.truncated, false);

    const limited = await searchProjects(root, { maxDirectories: 2 });
    assert.equal(limited.truncated, true);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(searchProjects(root, { signal: controller.signal }));
});

test('clone destinations must be new directories in writable parents', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'chs-clone-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.equal(
        await defaultCloneDestination(root),
        join(root, 'docker-chs-development'),
    );
    await mkdir(join(root, 'Workspace'));
    assert.equal(
        await defaultCloneDestination(root),
        join(root, 'Workspace', 'docker-chs-development'),
    );
    assert.match((await cloneDestinationError('relative')) ?? '', /absolute/);
    assert.match((await cloneDestinationError(root)) ?? '', /already exists/);
    assert.match(
        (await cloneDestinationError(join(root, 'missing', 'x'))) ?? '',
        /parent directory/,
    );
    assert.equal(await cloneDestinationError(join(root, 'new')), undefined);
});
