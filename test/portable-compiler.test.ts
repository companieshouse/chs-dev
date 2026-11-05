import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
    PortableDefinitionCompiler,
    interpolate,
    commandWords,
    envFile,
} from '../src/infrastructure/native/portable-compiler.js';
import { ComposeDefinitionCompiler } from '../src/infrastructure/native/compiler.js';
import { createProcessExecutor } from '../src/infrastructure/live-process.js';
import type { PreparedProject } from '../src/domain/live.js';

test('portable interpolation preserves dollar escapes, empty defaults and nested substitutions', () => {
    assert.equal(
        interpolate(
            '${EMPTY-default}|${EMPTY:-${X:-yes}}|${X+set}|$$HOME|$SET',
            { EMPTY: '', SET: 'ok' },
        ),
        '|yes||$HOME|ok',
    );
    assert.equal(interpolate('${SET:+chosen}', { SET: 'x' }), 'chosen');
    assert.throws(
        () => interpolate('${REQUIRED:?sensitive text}', {}),
        /REQUIRED/,
    );
    assert.deepEqual(commandWords('sh -c "echo hi" \'\' a\\ b'), [
        'sh',
        '-c',
        'echo hi',
        '',
        'a b',
    ]);
    assert.throws(() => commandWords('"bad'), /quote/);
    assert.deepEqual(
        envFile('A=\'${LITERAL}\'\nB=hello # comment\nC="line\\n${A}"\nD', {}),
        { A: '${LITERAL}', B: 'hello', C: 'line\n${LITERAL}', D: null },
    );
});

test('portable compilation normalizes the prepared CHS subset without invoking an executable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chs-compiler-'));
    try {
        const file = join(directory, 'compose.yaml');
        await writeFile(
            join(directory, 'vars.env'),
            'FROM_FILE=present\nOVERRIDE=old\n',
        );
        await writeFile(
            file,
            stringify({
                services: {
                    db: { image: 'alpine', healthcheck: { test: 'true' } },
                    app: {
                        image: 'alpine',
                        command: 'sh -c "echo $$HOME"',
                        environment: [
                            'OVERRIDE=new',
                            'INHERIT',
                            'KEYCLOAK_SECRET',
                            'EMPTY',
                            'FROM_FILE',
                        ],
                        env_file: ['vars.env'],
                        ports: ['127.0.0.1:8080:80', '9000:90/udp'],
                        volumes: ['./data:/data:ro', 'cache:/cache'],
                        networks: ['chs'],
                        depends_on: ['db'],
                        extra_hosts: ['account.chs.local=host-gateway'],
                    },
                    mapped: {
                        image: 'alpine',
                        environment: {
                            KEYCLOAK_SECRET: null,
                            INHERIT: null,
                            EMPTY: null,
                        },
                    },
                },
                volumes: { cache: {} },
                networks: { chs: {} },
            }),
        );
        const prepared: PreparedProject = {
            protocolVersion: 1,
            projectName: 'fixture',
            projectDirectory: directory,
            configurationIdentity: 'test',
            composeFiles: [file],
            inventory: [],
            environmentRequirements: [],
        };
        const context = {
            environment: {
                ...process.env,
                INHERIT: 'yes',
                EMPTY: '',
                KEYCLOAK_SECRET: undefined,
                FROM_FILE: undefined,
            },
        };
        const actual = await new PortableDefinitionCompiler().compile(
            prepared,
            context,
        );
        assert.equal(actual.services.app.environment.OVERRIDE, 'new');
        assert.equal(actual.services.app.environment.INHERIT, 'yes');
        assert.equal(actual.services.app.environment.EMPTY, '');
        assert.equal(
            Object.hasOwn(actual.services.app.environment, 'KEYCLOAK_SECRET'),
            false,
        );
        assert.equal(
            Object.hasOwn(actual.services.app.environment, 'FROM_FILE'),
            false,
        );
        assert.deepEqual(actual.services.mapped.environment, {
            INHERIT: 'yes',
            EMPTY: '',
        });
        assert.deepEqual(actual.services.app.command, [
            'sh',
            '-c',
            'echo $HOME',
        ]);
        assert.equal(actual.services.app.ports[0].hostIp, '127.0.0.1');
        assert.equal(actual.services.app.ports[1].published, '9000');
        assert.equal(actual.services.app.ports[1].protocol, 'udp');
        if (process.env.CHS_COMPILER_PARITY === '1') {
            const expected = await new ComposeDefinitionCompiler(
                createProcessExecutor(),
            ).compile(prepared, context);
            // `compose config` re-escapes dollars so its output can be read as Compose again.
            expected.services.app.command = expected.services.app.command?.map(
                (v) => v.replace(/\$\$/g, '$'),
            );
            // Compose materializes default flags; compare effective semantics.
            const normalize = (v: any): any =>
                Array.isArray(v)
                    ? v.map(normalize)
                    : v && typeof v === 'object'
                      ? Object.fromEntries(
                            Object.entries(v)
                                .filter(([, v]) => v !== undefined)
                                .map(([k, v]) => [k, normalize(v)]),
                        )
                      : v;
            assert.deepEqual(normalize(actual), normalize(expected));
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('environment files preserve CRLF, multiline quotes, escapes and interpolation precedence', () => {
    const source =
        'export A=file\r\nB="${A}\\nnext\r\nlast"\r\nC=\'${A}\r\nliteral\'\r\nD=${MISSING:-${A}}\r\nEMPTY=\r\nUNSET\r\n';
    assert.deepEqual(envFile(source, { A: 'process' }), {
        A: 'file',
        B: 'process\nnext\nlast',
        C: '${A}\nliteral',
        D: 'process',
        EMPTY: '',
        UNSET: null,
    });
    assert.deepEqual(envFile(String.raw`QUOTE="a\"b"` + '\nNEXT=ok', {}), {
        QUOTE: 'a"b',
        NEXT: 'ok',
    });
    assert.throws(() => envFile('A="unfinished\nB=value', {}), /quote/);
});

test('command words retain empty arguments, escaped quotes and literal single-quoted backslashes', () => {
    assert.deepEqual(commandWords(String.raw`tool '' "" "a\"b" 'c\d' e\ f`), [
        'tool',
        '',
        '',
        'a"b',
        'c\\d',
        'e f',
    ]);
    assert.throws(() => commandWords("tool 'unfinished"), /quote/);
});
