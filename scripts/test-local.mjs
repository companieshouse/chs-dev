import { spawn } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// This runner deliberately fails closed outside the local macOS test host.
// Normal npm test remains portable; no production service is started here.
if (process.platform !== 'darwin') {
    throw new Error('Local sandbox tests require macOS sandbox-exec.');
}

const directory = await mkdtemp(join(tmpdir(), 'chs-local-tests-'));
const temporaryRoot = await realpath(tmpdir());
const environment = {
    PATH: process.env.PATH,
    TMPDIR: tmpdir(),
    LANG: 'en_GB.UTF-8',
    TERM: 'xterm-256color',
    CHS_DEV_DAEMON_MODE: 'detached',
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_STATE_HOME: join(directory, 'state'),
    AWS_CONFIG_FILE: join(directory, 'aws-config'),
    AWS_SHARED_CREDENTIALS_FILE: join(directory, 'aws-credentials'),
    AWS_EC2_METADATA_DISABLED: 'true',
    DOCKER_CONFIG: join(directory, 'docker'),
    DOCKER_HOST: `unix://${directory}/no-engine.sock`,
    npm_config_update_notifier: 'false',
};
const policy = `
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
(allow network-outbound (remote unix-socket (path-prefix (param "TEST_TMP"))))
(deny file-read* (subpath (param "AWS_HOME")) (subpath (param "SSH_HOME")))
(deny process-exec (literal "/usr/bin/ssh") (literal "/usr/bin/rsync"))
`;
const files = process.argv.slice(2);
if (!files.length) {
    files.push(
        ...(await readdir('test'))
            .filter((name) => /\.test\.(ts|mjs)$/.test(name))
            .sort()
            .map((name) => join('test', name)),
    );
}

try {
    const child = spawn(
        '/usr/bin/sandbox-exec',
        [
            '-D',
            `TEST_TMP=${temporaryRoot}`,
            '-D',
            `AWS_HOME=${join(homedir(), '.aws')}`,
            '-D',
            `SSH_HOME=${join(homedir(), '.ssh')}`,
            '-p',
            policy,
            process.execPath,
            '--import',
            'tsx',
            '--test',
            ...files,
        ],
        { env: environment, stdio: 'inherit' },
    );
    process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code ?? 1));
    });
} finally {
    await rm(directory, { recursive: true, force: true });
}
