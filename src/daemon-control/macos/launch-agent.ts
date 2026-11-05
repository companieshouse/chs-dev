import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { daemonPaths, daemonProgram } from '../discovery.js';
import { daemonEnvironment } from '../environment.js';
import { exclusiveLease } from '../../infrastructure/daemon-state.js';

const exec = promisify(execFile);
const xml = (value: string) =>
    value.replace(
        /[&<>"']/g,
        (c) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&apos;',
            })[c]!,
    );
export function launchAgent() {
    const paths = daemonPaths();
    const label = `uk.gov.companieshouse.chs-dev.${paths.identity}`;
    return {
        label,
        path: join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`),
        domain: `gui/${process.getuid!()}`,
        paths,
    };
}
export function launchAgentPlist(env: NodeJS.ProcessEnv = process.env) {
    const { label } = launchAgent(),
        program = daemonProgram();
    const environment = Object.entries(daemonEnvironment(env))
        .map(
            ([name, value]) =>
                `<key>${name}</key><string>${xml(value!)}</string>`,
        )
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${[program.command, ...program.args].map((arg) => `<string>${xml(arg)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(program.cwd)}</string><key>EnvironmentVariables</key><dict>${environment}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`;
}
export async function ensureLaunchAgent(
    replace = false,
    env: NodeJS.ProcessEnv = process.env,
) {
    if (process.platform !== 'darwin')
        throw new Error('Login service installation is supported on macOS.');
    const { label, path, domain, paths } = launchAgent();
    const release = await exclusiveLease(
        join(paths.state, 'installation.lock'),
    ).catch(() => undefined);
    if (!release) return;
    try {
        await mkdir(join(homedir(), 'Library', 'LaunchAgents'), {
            recursive: true,
            mode: 0o700,
        });
        const existing = await readFile(path, 'utf8').catch(() => undefined);
        if (!existing || replace) {
            const temporary = `${path}.${process.pid}.tmp`;
            await writeFile(temporary, launchAgentPlist(env), {
                flag: 'wx',
                mode: 0o600,
            });
            await rename(temporary, path);
        }
        const loaded = await exec(
            '/bin/launchctl',
            ['print', `${domain}/${label}`],
            { timeout: 5000 },
        ).then(
            () => true,
            () => false,
        );
        if (!loaded)
            await exec('/bin/launchctl', ['bootstrap', domain, path], {
                timeout: 10000,
            });
        else
            await exec('/bin/launchctl', ['kickstart', `${domain}/${label}`], {
                timeout: 10000,
            });
    } finally {
        await release();
    }
}
export async function stopLaunchAgent(remove = false) {
    const { label, path, domain } = launchAgent();
    const loaded = await exec(
        '/bin/launchctl',
        ['print', `${domain}/${label}`],
        { timeout: 5000 },
    ).then(
        () => true,
        () => false,
    );
    if (loaded)
        await exec('/bin/launchctl', ['bootout', `${domain}/${label}`], {
            timeout: 30000,
        });
    if (remove) await rm(path, { force: true });
}
