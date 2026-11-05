import { mkdir, stat, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHmac } from 'node:crypto';
import type {
    Mount,
    ResolvedProject,
    ServiceSpec,
} from '../../domain/orchestration.js';
import { LiveFailure } from '../../domain/live.js';

/** Apple shares directories. Project only declared secrets/configs into dedicated directories. */
export async function adaptAppleFileMounts(
    project: ResolvedProject,
    state: string,
) {
    for (const spec of Object.values(project.services))
        await adaptServiceFileMounts(spec, state);
}

async function adaptServiceFileMounts(spec: ServiceSpec, state: string) {
    const additions: typeof spec.mounts = [];
    const remove = new Set<Mount>();
    for (const mount of spec.mounts)
        await adaptFileMount(spec, mount, state, additions, remove);
    spec.mounts = [...spec.mounts.filter((m) => !remove.has(m)), ...additions];
}

/** Decides whether a file bind mount is adaptable, throwing when Apple cannot honor it. */
function fileMountClassification(spec: ServiceSpec, mount: Mount) {
    const secret = mount.target.startsWith('/run/secrets/');
    const config = ['prometheus', 'otel-collector', 'tempo', 'loki'].includes(
        spec.name,
    );
    const grafana =
        spec.name === 'grafana' &&
        mount.target.startsWith('/etc/grafana/provisioning/');
    if (!secret && !config && !grafana)
        throw new LiveFailure(
            `${spec.source}: ${spec.name}: Apple 1.5 requires directory bind mounts. Mount the parent directory for ${mount.target}. CHS secrets and monitoring configuration files are adapted automatically.`,
            'blocked',
        );
    if (secret && !mount.readOnly)
        throw new LiveFailure(
            `${spec.name}: secret file mounts must be read-only.`,
            'blocked',
        );
    return { secret, config, grafana };
}

/** Hashes every file bind mount of the service into a stable materialization directory. */
async function materializeDirectory(
    spec: ServiceSpec,
    state: string,
    target: string,
) {
    const key = await readFile(join(state, 'fingerprint.key'));
    const version = createHmac('sha256', key).update(target);
    for (const input of spec.mounts
        .filter((m) => m.type === 'bind' && m.source)
        .sort((a, b) => a.target.localeCompare(b.target))) {
        const info = await stat(input.source!).catch(() => undefined);
        if (info?.isFile())
            version.update(input.target).update(await readFile(input.source!));
    }
    const directory = join(
        state,
        'file-mounts',
        spec.name,
        version.digest('hex'),
    );
    await mkdir(directory, { recursive: true, mode: 0o755 });
    await chmod(directory, 0o755);
    return directory;
}

async function materializeFile(
    spec: ServiceSpec,
    mount: Mount,
    state: string,
    target: string,
    secret: boolean,
) {
    const directory = await materializeDirectory(spec, state, target);
    const file = join(directory, basename(mount.target));
    const bytes = await readFile(mount.source!);
    if (!(await readFile(file).catch(() => undefined))?.equals(bytes))
        await writeFile(file, bytes, { mode: secret ? 0o600 : 0o644 });
    await chmod(file, secret ? 0o600 : 0o644);
    return directory;
}

function rewriteConfigCommand(spec: ServiceSpec, mount: Mount, target: string) {
    const replacement = join(target, basename(mount.target));
    spec.command = spec.command?.map((arg) =>
        arg.replaceAll(mount.target, replacement),
    );
}

function parentProvidesFile(spec: ServiceSpec, mount: Mount, parent: string) {
    return spec.mounts.find(
        (candidate) =>
            candidate !== mount &&
            candidate.type === 'bind' &&
            candidate.target === parent &&
            candidate.source === dirname(mount.source!),
    );
}

function isLocalBind(mount: Mount): mount is Mount & { source: string } {
    return (
        mount.type === 'bind' && Boolean(mount.source) && !mount.daemonSource
    );
}

async function adaptFileMount(
    spec: ServiceSpec,
    mount: Mount,
    state: string,
    additions: Mount[],
    remove: Set<Mount>,
) {
    if (!isLocalBind(mount)) return;
    const info = await stat(mount.source).catch(() => undefined);
    if (!info?.isFile()) return;
    const { secret, config, grafana } = fileMountClassification(spec, mount);
    // A whole directory mount may already provide the same Grafana provisioning file.
    const parent = dirname(mount.target);
    const covered = grafana && parentProvidesFile(spec, mount, parent);
    if (covered) {
        remove.add(mount);
        return;
    }
    const target = config ? '/etc/chs-config' : parent;
    const directory = await materializeFile(spec, mount, state, target, secret);
    spec.fileInputs ??= [];
    spec.fileInputs.push(mount.source);
    if (config) rewriteConfigCommand(spec, mount, target);
    remove.add(mount);
    if (!additions.some((m) => m.target === target))
        additions.push({
            type: 'bind',
            source: directory,
            target,
            readOnly: true,
        });
}
