#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    cp,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rename,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
    applyMutant,
    generateMutants,
    parseSource,
} from './mutation-operators.mjs';

import { classifyRun, summarize, tapSummary } from './mutation-results.mjs';

const excluded = new Set(['.git', 'node_modules', 'dist', '.scratch', 'tmp']);
let interrupted = false;
let activeChild;

function killGroup(child, signal) {
    if (!child?.pid) return;
    try {
        process.kill(-child.pid, signal);
    } catch (error) {
        if (error.code !== 'ESRCH') return `${error.code}: ${error.message}`;
    }
}

function interrupt() {
    interrupted = true;
    killGroup(activeChild, 'SIGKILL');
}

function argumentsFrom(argv) {
    const options = { root: process.cwd() };
    for (let index = 0; index < argv.length; index++) {
        const key = argv[index];
        if (key === '--list') {
            options.list = true;
            continue;
        }
        if (
            !['--config', '--root', '--only-ids'].includes(key) ||
            !argv[index + 1]
        ) {
            throw new Error(`Unknown or incomplete argument: ${key}`);
        }
        options[key.slice(2)] = argv[++index];
    }
    if (!options.config)
        throw new Error(
            'Usage: node scripts/mutation-test.mjs --config config.json [--list] [--only-ids id,id] [--root directory]',
        );
    return options;
}

function localPath(root, file) {
    const path = resolve(root, file);
    if (isAbsolute(file) || relative(root, path).split(sep).includes('..')) {
        throw new Error(`Expected a path inside the project: ${file}`);
    }
    return path;
}

function validateFileList(files, key) {
    if (
        !Array.isArray(files) ||
        !files.length ||
        files.some((value) => typeof value !== 'string')
    ) {
        throw new Error(
            `Config needs a nonempty ${key} array of relative paths`,
        );
    }
}

function validateConfig(config) {
    if (typeof config.name !== 'string' || !config.name.trim())
        throw new Error('Config needs a name');
    for (const key of ['files', 'tests']) validateFileList(config[key], key);
    if (typeof config.outputDirectory !== 'string' || !config.outputDirectory)
        throw new Error('Config needs outputDirectory');
    const timeoutMs = config.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3600000)
        throw new Error('timeoutMs must be an integer from 100 to 3600000');
    return { ...config, timeoutMs };
}

async function atomicJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 4)}\n`);
    await rename(`${path}.tmp`, path);
}

function hashesFor(files) {
    return Object.fromEntries(
        [...files].map(([file, source]) => [
            file,
            createHash('sha256').update(source).digest('hex'),
        ]),
    );
}

async function manifestFor(root, config) {
    const sources = new Map();
    const tests = new Map();
    const mutants = [];
    for (const file of [...new Set(config.files)].sort()) {
        const source = await readFile(localPath(root, file), 'utf8');
        sources.set(file, source);
        mutants.push(...generateMutants(source, file));
    }
    for (const file of config.tests) {
        tests.set(file, await readFile(localPath(root, file), 'utf8'));
    }
    return {
        sources,
        snapshots: new Map([...sources, ...tests]),
        manifest: {
            name: config.name,
            sourceHashes: hashesFor(sources),
            testHashes: hashesFor(tests),
            tests: config.tests,
            mutants,
        },
    };
}

function selectMutants(manifest, options, config) {
    const ids = options['only-ids']?.split(',') ?? config.onlyIds;
    if (ids === undefined) return manifest.mutants;
    if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.some((id) => typeof id !== 'string')
    )
        throw new Error('onlyIds must be a nonempty array of IDs');
    const known = new Set(manifest.mutants.map((mutant) => mutant.id));
    for (const id of ids) {
        if (!known.has(id)) throw new Error(`Unknown mutant ID: ${id}`);
    }
    return manifest.mutants.filter((mutant) => ids.includes(mutant.id));
}

async function copyWorkspace(root, outputDirectory) {
    const workspace = await mkdtemp(join(tmpdir(), 'chs-mutation-'));
    try {
        await cp(root, workspace, {
            recursive: true,
            dereference: true,
            filter: (path) =>
                !relative(root, path)
                    .split(sep)
                    .some((part) => excluded.has(part)) &&
                path !== outputDirectory,
        });
        await symlink(
            await realpath(join(root, 'node_modules')),
            join(workspace, 'node_modules'),
            'dir',
        );
        await mkdir(join(workspace, 'tmp'), { recursive: true });
        return workspace;
    } catch (error) {
        await rm(workspace, { recursive: true, force: true });
        throw error;
    }
}

function captureChild(child) {
    return new Promise((resolveChild) => {
        const chunks = [];
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stderr.on('data', (chunk) => chunks.push(chunk));
        child.once('error', (error) =>
            resolveChild({
                error: error.message,
                output: Buffer.concat(chunks).toString(),
            }),
        );
        child.once('close', (exitCode, signal) =>
            resolveChild({
                exitCode,
                signal,
                output: Buffer.concat(chunks).toString(),
            }),
        );
    });
}

async function runTests(workspace, config, logPath) {
    const started = Date.now();
    const child = spawn(
        process.execPath,
        ['scripts/test-local.mjs', '--test-reporter=tap', ...config.tests],
        {
            cwd: workspace,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, TMPDIR: join(workspace, 'tmp') },
        },
    );
    activeChild = child;
    let timedOut = false;
    const deadline = setTimeout(() => {
        timedOut = true;
        killGroup(child, 'SIGTERM');
    }, config.timeoutMs);
    const teardown = setTimeout(
        () => killGroup(child, 'SIGKILL'),
        config.timeoutMs + 250,
    );
    const result = await captureChild(child);
    clearTimeout(deadline);
    clearTimeout(teardown);
    // Even a successful wrapper must not leave background descendants running.
    const teardownError = killGroup(child, 'SIGKILL');
    activeChild = undefined;
    await writeFile(logPath, result.output);
    const details = {
        ...result,
        processGroupId: child.pid,
        teardownError,
        timedOut,
        durationMs: Date.now() - started,
        log: logPath,
        tap: tapSummary(result.output),
    };
    return { ...details, status: classifyRun(details) };
}

function reportRun(result) {
    const { output: _output, ...details } = result;
    return details;
}

async function evaluateMutant(context, mutant) {
    const { workspace, sources, config, outputDirectory } = context;
    const path = join(workspace, mutant.file);
    const original = sources.get(mutant.file);
    const changed = applyMutant(original, mutant);
    try {
        parseSource(changed, mutant.file);
    } catch (error) {
        return {
            ...mutant,
            status: 'invalid',
            error: error.message,
            durationMs: 0,
        };
    }
    await writeFile(path, changed);
    try {
        const result = await runTests(
            workspace,
            config,
            join(outputDirectory, 'logs', `${mutant.id}.tap`),
        );
        return { ...mutant, ...reportRun(result) };
    } finally {
        await writeFile(path, original);
    }
}

async function execute(context, mutants, report) {
    const reportPath = join(context.outputDirectory, 'report.json');
    const baseline = await runTests(
        context.workspace,
        context.config,
        join(context.outputDirectory, 'logs', 'baseline.tap'),
    );
    report.baseline = reportRun(baseline);
    await atomicJson(reportPath, report);
    if (baseline.status !== 'survived')
        throw new Error(
            `Baseline failed (${baseline.status}); see ${baseline.log}`,
        );
    for (const mutant of mutants) {
        if (interrupted) throw new Error('Mutation run interrupted');
        report.results.push(await evaluateMutant(context, mutant));
        report.summary = summarize(report.results);
        await atomicJson(reportPath, report);
        if (
            report.results.length % 10 === 0 ||
            report.results.length === mutants.length
        ) {
            console.log(
                `${context.config.name}: ${report.results.length}/${mutants.length} ${JSON.stringify(report.summary.counts)}`,
            );
        }
    }
    report.complete = true;
    report.finishedAt = new Date().toISOString();
    await atomicJson(reportPath, report);
}

async function main() {
    const options = argumentsFrom(process.argv.slice(2));
    const root = await realpath(resolve(options.root));
    const config = validateConfig(
        JSON.parse(await readFile(resolve(root, options.config), 'utf8')),
    );
    const outputDirectory = resolve(root, config.outputDirectory);
    if (outputDirectory === root)
        throw new Error('outputDirectory must not be the project root');
    const { sources, snapshots, manifest } = await manifestFor(root, config);
    const mutants = selectMutants(manifest, options, config);
    await atomicJson(join(outputDirectory, 'manifest.json'), manifest);
    console.log(
        `${config.name}: ${manifest.mutants.length} generated, ${mutants.length} selected`,
    );
    if (options.list) return;
    await mkdir(join(outputDirectory, 'logs'), { recursive: true });
    const workspace = await copyWorkspace(root, outputDirectory);
    const report = {
        ...manifest,
        startedAt: new Date().toISOString(),
        complete: false,
        selectedIds: mutants.map((mutant) => mutant.id),
        timeoutMs: config.timeoutMs,
        workspace,
        results: [],
        summary: summarize([]),
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
        for (const [file, contents] of snapshots)
            await writeFile(join(workspace, file), contents);
        await execute(
            { workspace, sources, config, outputDirectory },
            mutants,
            report,
        );
        if (
            report.results.some((result) =>
                ['invalid', 'infrastructure-error', 'timeout'].includes(
                    result.status,
                ),
            )
        )
            process.exitCode = 2;
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        await rm(workspace, { recursive: true, force: true });
    }
}

try {
    await main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
