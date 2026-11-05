import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import type { PreparedProject } from '../../domain/live.js';
import type {
    Mount,
    ResolvedProject,
    ServiceSpec,
} from '../../domain/orchestration.js';

async function adaptScriptContainer(
    spec: ServiceSpec,
    project: ResolvedProject,
) {
    if (!/^execute-.*-scripts$/.test(spec.name)) return;
    const target =
        spec.environment.SCRIPT_CONTAINER_NAME_EXACT ??
        spec.environment.SCRIPT_CONTAINER_NAME;
    if (!target || !project.services[target])
        throw new Error(`${spec.name}: initialization target is missing`);
    spec.environment.SCRIPT_CONTAINER_NAME_EXACT = target;
}

/** Rewrites bind mounts that would point outside the managed state directory. */
function adaptMount(
    mount: Mount,
    operationRoots: string[],
    project: ResolvedProject,
    state: string,
) {
    if (mount.type !== 'bind' || !mount.source) return;
    if (
        ['/var/run/docker.sock', '/var/lib/docker/containers'].includes(
            mount.source,
        )
    )
        mount.daemonSource = true;
    if (operationRoots.some((root) => mount.source === join(root, 'out'))) {
        mount.source = join(state, 'work', 'out');
        mount.createHostPath = true;
    }
    if (mount.source === join(project.directory, 'local', 'tempo-data')) {
        mount.source = join(state, 'data', 'tempo');
        mount.createHostPath = true;
    }
}

function addIngressProxyConstraints(
    spec: ServiceSpec,
    project: ResolvedProject,
) {
    spec.command = [
        ...(spec.command ?? []),
        `--providers.docker.constraints=Label(\`chs.dev.project\`, \`${project.namespace}\`)`,
        `--providers.docker.network=${project.namespace}-chs`,
    ];
}

function addProjectLabelFilters(document: any, namespace: string) {
    for (const scrape of document.scrape_configs ?? [])
        for (const discovery of scrape.docker_sd_configs ?? []) {
            discovery.filters = [
                ...(discovery.filters ?? []),
                {
                    name: 'label',
                    values: [`chs.dev.project=${namespace}`],
                },
            ];
        }
}

async function rewritePrometheusConfig(
    spec: ServiceSpec,
    project: ResolvedProject,
    state: string,
) {
    const config = spec.mounts.find((m) => m.target === '/etc/prometheus.yaml');
    if (!config?.source) return;
    const document = parse(await readFile(config.source, 'utf8'));
    addProjectLabelFilters(document, project.namespace);
    const contents = stringify(document);
    const directory = join(state, 'generated');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(
        directory,
        `prometheus-${createHash('sha256').update(contents).digest('hex')}.yaml`,
    );
    try {
        await writeFile(file, contents, { flag: 'wx', mode: 0o600 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    config.source = file;
    config.readOnly = true;
}

/** CHS-specific adaptations stay outside the compiler and orchestration rules. */
export async function adaptChsProject(
    project: ResolvedProject,
    prepared: PreparedProject,
    state: string,
) {
    const operationRoots = prepared.composeFiles.map(dirname);
    for (const spec of Object.values(project.services)) {
        await adaptScriptContainer(spec, project);
        for (const mount of spec.mounts)
            adaptMount(mount, operationRoots, project, state);
        if (spec.name === 'ingress-proxy')
            addIngressProxyConstraints(spec, project);
        if (spec.name === 'prometheus')
            await rewritePrometheusConfig(spec, project, state);
    }
}
