import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';
import { LiveFailure, type PreparedProject } from '../../domain/live.js';
import {
    translate,
    type CompilationContext,
    type DefinitionCompiler,
} from './compiler.js';

/** Index of the `}` closing a `${` opened at `open`; throws when unclosed. */
function closingBrace(input: string, open: number): number {
    let depth = 1;

    for (let end = open; end < input.length; end++) {
        if (input[end] === '{' && input[end - 1] === '$') depth++;
        if (input[end] === '}') {
            depth--;
            if (!depth) return end;
        }
    }

    throw new Error('Unclosed environment substitution');
}

/** Apply `:-`/`:+` word semantics once presence of the variable is known. */
function applyOperator(
    operator: string,
    present: boolean,
    value: string | undefined,
    fallback: string,
    env: NodeJS.ProcessEnv,
): string {
    if (operator.endsWith('-'))
        return present ? value! : interpolate(fallback, env);

    if (operator.endsWith('+'))
        return present ? interpolate(fallback, env) : '';

    return value ?? '';
}

function substitutionPresent(value: string | undefined, operator?: string) {
    return value !== undefined && (!operator?.startsWith(':') || value !== '');
}

/** Evaluate one `${name[:operator][word]}` expression against `env`. */
function evaluateSubstitution(
    expression: string,
    env: NodeJS.ProcessEnv,
): string {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+?])(.*))?$/s.exec(
        expression,
    );
    if (!match) throw new Error('Unsupported environment substitution');

    const [, name, operator, fallback = ''] = match;
    const value = env[name];
    const present = substitutionPresent(value, operator);

    if (operator?.endsWith('?') && !present)
        throw new Error(`Required environment variable ${name} is unavailable`);

    return operator
        ? applyOperator(operator, present, value, fallback, env)
        : (value ?? '');
}

/** Replacement text for one `$` reference plus the index to resume after. */
interface Substitution {
    text: string;
    next: number;
}

function substituteBare(
    input: string,
    index: number,
    env: NodeJS.ProcessEnv,
): Substitution {
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(index + 1))?.[0];
    return name
        ? { text: env[name] ?? '', next: index + 1 + name.length }
        : { text: '$', next: index + 1 };
}

function substituteBraced(
    input: string,
    index: number,
    env: NodeJS.ProcessEnv,
): Substitution {
    const end = closingBrace(input, index + 2);
    return {
        text: evaluateSubstitution(input.slice(index + 2, end), env),
        next: end + 1,
    };
}

/** Compose interpolation is substitution, never execution by a host shell. */
export function interpolate(input: string, env: NodeJS.ProcessEnv): string {
    let output = '';

    for (let i = 0; i < input.length; i++) {
        if (input[i] !== '$') {
            output += input[i];
            continue;
        }

        if (input[i + 1] === '$') {
            output += '$';
            i++;
            continue;
        }

        const substitution =
            input[i + 1] === '{'
                ? substituteBraced(input, i, env)
                : substituteBare(input, i, env);
        output += substitution.text;
        i = substitution.next - 1;
    }

    return output;
}

interface CommandWordState {
    word: string;
    quote: string;
    present: boolean;
}

function commandEscape(input: string, index: number, quote: string) {
    if (index + 1 === input.length)
        throw new Error('Unterminated command escape');

    if (
        quote === '"' &&
        !['"', '\\', '$', '`', '\n'].includes(input[index + 1])
    )
        return { text: '\\', next: index };

    return { text: input[index + 1], next: index + 1 };
}

function consumeCommandCharacter(
    input: string,
    index: number,
    state: CommandWordState,
    result: string[],
) {
    const character = input[index];

    if (character === '\\' && state.quote !== "'") {
        const escaped = commandEscape(input, index, state.quote);
        state.word += escaped.text;
        state.present = true;
        return escaped.next;
    }

    if (state.quote) {
        if (character === state.quote) state.quote = '';
        else state.word += character;
        state.present = true;
        return index;
    }

    if (character === '"' || character === "'") {
        state.quote = character;
        state.present = true;
        return index;
    }

    if (/\s/.test(character)) {
        if (state.present) result.push(state.word);
        state.word = '';
        state.present = false;
        return index;
    }

    state.word += character;
    state.present = true;
    return index;
}

/** Split Compose command strings without interpreting shell operators or expansion. */
export function commandWords(input: string): string[] {
    const result: string[] = [];
    const state: CommandWordState = { word: '', quote: '', present: false };

    for (let index = 0; index < input.length; index++)
        index = consumeCommandCharacter(input, index, state, result);

    if (state.quote) throw new Error('Unterminated command quote');
    if (state.present) result.push(state.word);

    return result;
}

function keyValues(
    value: any,
    env: NodeJS.ProcessEnv,
    inherit = false,
): Record<string, any> {
    if (!Array.isArray(value))
        return Object.fromEntries(
            Object.entries(value ?? {}).map(([k, v]) => [
                k,
                v === null && inherit ? (env[k] ?? null) : v,
            ]),
        );

    return Object.fromEntries(
        value.map((entry: unknown) => {
            if (typeof entry !== 'string')
                throw new Error('Expected key=value strings');

            const index = entry.indexOf('=');
            return index < 0
                ? [entry, inherit ? (env[entry] ?? null) : '']
                : [entry.slice(0, index), entry.slice(index + 1)];
        }),
    );
}

const closingQuotes = { "'": /(?<!\\)'/, '"': /(?<!\\)"/ };

function quotedEnvValue(lines: string[], index: number, initial: string) {
    const quote = initial[0] as keyof typeof closingQuotes;
    const closing = closingQuotes[quote];
    let value = initial;
    let next = index + 1;

    while (!closing.test(value.slice(1)) && next < lines.length) {
        value += '\n' + lines[next];
        next++;
    }

    const close = value.slice(1).search(closing) + 1;
    if (close < 1) throw new Error('Unterminated environment file quote');

    return { value: value.slice(1, close), next, quote };
}

function decodeDoubleQuoted(value: string) {
    const escapes: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        '"': '"',
        '\\': '\\',
    };

    return value.replace(
        /\\([nrt"\\])/g,
        (_, character: string) => escapes[character]!,
    );
}

export function envFile(
    input: string,
    env: NodeJS.ProcessEnv,
): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    const lines = input.replace(/\r\n/g, '\n').split('\n');
    let cursor = 0;

    while (cursor < lines.length) {
        const lineNumber = cursor + 1;
        const line = lines[cursor]!.trim().replace(/^export\s+/, '');
        cursor++;
        if (!line || line.startsWith('#')) continue;

        const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.*))?$/.exec(line);
        if (!match)
            throw new Error(
                `Invalid environment file entry on line ${lineNumber}`,
            );

        const name = match[1]!;
        if (match[2] === undefined) {
            result[name] = null;
            continue;
        }

        let value = match[2];
        let literal = false;
        if (value.startsWith("'") || value.startsWith('"')) {
            const quoted = quotedEnvValue(lines, cursor - 1, value);
            cursor = quoted.next;
            literal = quoted.quote === "'";
            value = literal
                ? quoted.value.replace(/\\'/g, "'")
                : decodeDoubleQuoted(quoted.value);
        } else value = value.replace(/\s+#.*$/, '').trim();

        result[name] = literal
            ? value
            : interpolate(value, { ...result, ...env } as NodeJS.ProcessEnv);
    }

    return result;
}

function walk(value: any, env: NodeJS.ProcessEnv): any {
    if (typeof value === 'string') return interpolate(value, env);
    if (Array.isArray(value)) return value.map((v) => walk(v, env));
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, walk(v, env)]),
        );

    return value;
}

const array = (v: any): any[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

function shortMount(value: string) {
    const parts = value.split(':');
    if (parts.length > 3) throw new Error('Unsupported mount syntax');

    const source = parts.length > 1 ? parts[0] : undefined;
    const target = parts.length > 1 ? parts[1] : parts[0];
    const options = parts[2]?.split(',') ?? [];
    if (options.some((v) => !['ro', 'rw'].includes(v)))
        throw new Error('Unsupported mount options');

    return { source, target, options };
}

function mount(value: any, base: string): any {
    if (typeof value !== 'string') {
        const m = { ...value };
        if (m.type === 'bind' && m.source) m.source = resolve(base, m.source);
        return m;
    }

    const { source, target, options } = shortMount(value);
    const type =
        source && (isAbsolute(source) || source.startsWith('.'))
            ? 'bind'
            : 'volume';

    return {
        type,
        source: type === 'bind' ? resolve(base, source!) : source,
        target,
        read_only: options.includes('ro'),
        ...(type === 'bind' ? { bind: { create_host_path: true } } : {}),
    };
}

function port(value: any): any {
    if (typeof value === 'object') return value;

    const match =
        /^(?:(\[[^\]]+\]|[^:]+):)?(?:(\d+):)?(\d+)(?:\/(tcp|udp))?$/.exec(
            String(value),
        );
    if (!match)
        throw new Error('Native ports require individual numeric ports');

    let host: string | undefined = match[1],
        published: string | undefined = match[2];
    const target = match[3],
        protocol = match[4];

    if (host && !published && /^\d+$/.test(host)) {
        published = host;
        host = undefined;
    } else if (host && !published)
        throw new Error('Host port is required with an address');

    return {
        target: Number(target),
        published,
        host_ip: host?.replace(/^\[|\]$/g, ''),
        protocol: protocol ?? 'tcp',
    };
}

/** Merge `env_file` entries into `environment`, then drop the `env_file` key. */
async function inheritServiceEnvironment(
    spec: any,
    base: string,
    env: NodeJS.ProcessEnv,
): Promise<void> {
    const inherited: Record<string, any> = {};

    for (const item of array(spec.env_file)) {
        const path = resolve(base, typeof item === 'string' ? item : item.path);
        try {
            if (typeof item === 'object' && item.format)
                throw new Error('env_file.format is unsupported');

            Object.assign(
                inherited,
                envFile(await readFile(path, 'utf8'), env),
            );
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
                item.required !== false
            )
                throw error;
        }
    }

    spec.environment = {
        ...inherited,
        ...keyValues(spec.environment, env, true),
    };
    delete spec.env_file;
}

/** Convert dependency lists/objects to the long-form condition records. */
function normalizeDependsOn(spec: any): void {
    if (Array.isArray(spec.depends_on)) {
        spec.depends_on = Object.fromEntries(
            spec.depends_on.map((v: string) => [
                v,
                {
                    condition: 'service_started',
                    required: true,
                },
            ]),
        );
        return;
    }

    for (const dep of Object.values(spec.depends_on ?? {}) as any[])
        dep.condition ??= 'service_started';
}

/** Normalize command, entrypoint, healthcheck and depends_on for one service. */
function normalizeServiceExecution(spec: any): void {
    for (const field of ['command', 'entrypoint'])
        if (typeof spec[field] === 'string')
            spec[field] = commandWords(spec[field]);

    spec.command ??= null;
    spec.entrypoint ??= null;

    if (spec.healthcheck && typeof spec.healthcheck.test === 'string')
        spec.healthcheck.test = ['CMD-SHELL', spec.healthcheck.test];

    normalizeDependsOn(spec);
}

/** Normalize networks, volumes, ports and DNS lists for one service. */
function normalizeServiceNetworking(spec: any, base: string): void {
    if (Array.isArray(spec.networks))
        spec.networks = Object.fromEntries(
            spec.networks.map((v: string) => [v, null]),
        );

    spec.volumes = array(spec.volumes).map((v) => mount(v, base));
    spec.ports = array(spec.ports).map(port);

    for (const field of ['dns', 'dns_search'])
        if (spec[field] !== undefined) spec[field] = array(spec[field]);
}

/** Resolve build context/args and inline string references for one service. */
function normalizeServiceReferences(
    spec: any,
    base: string,
    env: NodeJS.ProcessEnv,
): void {
    if (typeof spec.build === 'string')
        spec.build = { context: resolve(base, spec.build) };
    if (spec.build) {
        spec.build.context = resolve(base, spec.build.context ?? '.');
        spec.build.args = keyValues(spec.build.args, env, true);
    }

    for (const field of ['secrets', 'configs'])
        if (spec[field])
            spec[field] = spec[field].map((v: any) =>
                typeof v === 'string' ? { source: v } : v,
            );

    if (spec.user !== undefined) spec.user = String(spec.user);
}

/** Apply every service-level normalization to one service spec. */
async function normalizeServiceSpec(
    spec: any,
    base: string,
    env: NodeJS.ProcessEnv,
): Promise<void> {
    await inheritServiceEnvironment(spec, base, env);
    spec.labels = keyValues(spec.labels, env);
    normalizeServiceExecution(spec);
    normalizeServiceNetworking(spec, base);
    normalizeServiceReferences(spec, base, env);
}

/** Normalize one service, attributing failures to its declared source. */
async function normalizeService(
    name: string,
    spec: any,
    prepared: PreparedProject,
    context: CompilationContext,
): Promise<void> {
    try {
        await normalizeServiceSpec(
            spec,
            prepared.projectDirectory,
            context.environment,
        );
    } catch (error) {
        throw new Error(
            `${prepared.sources?.[name] ?? prepared.composeFiles[0]}: ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/** Normalize top-level labels and secrets/configs file paths. */
function normalizeResourceFiles(document: any, base: string) {
    for (const field of ['secrets', 'configs'])
        for (const value of Object.values(document[field] ?? {}) as any[])
            if (value?.file) value.file = resolve(base, value.file);
}

function normalizeTopLevel(
    document: any,
    base: string,
    env: NodeJS.ProcessEnv,
): void {
    for (const field of ['volumes', 'networks'])
        for (const value of Object.values(document[field] ?? {}) as any[])
            if (value?.labels) value.labels = keyValues(value.labels, env);

    normalizeResourceFiles(document, base);
}

export class PortableDefinitionCompiler implements DefinitionCompiler {
    async compile(prepared: PreparedProject, context: CompilationContext) {
        context.signal?.throwIfAborted();
        if (prepared.composeFiles.length !== 1)
            throw new LiveFailure(
                'Native compilation requires one prepared project document.',
                'blocked',
            );

        try {
            const document = walk(
                parse(await readFile(prepared.composeFiles[0], 'utf8')),
                context.environment,
            );

            for (const [name, spec] of Object.entries(
                document.services ?? {},
            ) as [string, any][])
                await normalizeService(name, spec, prepared, context);

            normalizeTopLevel(
                document,
                prepared.projectDirectory,
                context.environment,
            );

            return translate(document, prepared);
        } catch (error) {
            throw new LiveFailure(
                `Project compilation failed: ${error instanceof Error ? error.message : String(error)}`,
                'blocked',
            );
        }
    }
}
