import { createHash } from 'node:crypto';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
} from 'node:path';
import { parse, stringify } from 'yaml';
import type { InventoryEntry, PreparedProject } from '../domain/live.js';
import {
    mockRuntimeService,
    mockOnlyInventory,
    withMockRuntime,
    type PreparationExclusion,
} from '../domain/live.js';
import {
    mockProviderSpec,
    microcksSpec,
    prepareMockBootstrap,
} from './mock-provider.js';
import { mocksDirectory } from './mock-catalogue.js';
import {
    labels,
    mapping,
    merge,
    normalizePaths,
    ProjectError,
    requiredEnvironment,
    type Mapping,
} from './compose.js';
import { optionalFile, type ProjectFs } from './files.js';
import { initialize } from './initialization.js';
import {
    loadDefinitions,
    readState,
    resolveSelection,
    resolveServices,
    resolveSshRequirements,
    type Definitions,
    type ServiceDefinition,
} from './resolve.js';
import { selectedJourney } from './journeys.js';
import { loadUsagePolicy } from './usage-cache.js';
import { routerLabels } from '../proxy/labels.js';
import { attributeEnvironment, blockedSet } from './attribution.js';
import type { ImageSelections } from '../domain/image-versions.js';

export interface RepositoryRequest {
    service: string;
    directory: string;
    url?: unknown;
    branch?: unknown;
}
export type CommandRunner = (
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
) => Promise<void>;

export interface ProjectDependencies {
    fs: ProjectFs;
    /** Environment used for `COMPOSE_PROJECT_NAME`; never written to generated files. */
    env: NodeJS.ProcessEnv;
    /** Environment requirement checks for the generated stack. */
    environment: {
        /** Fails when any requirement has no value. */
        enforce(names: readonly string[]): Promise<void>;
        /** Requirements that would fail, reported without throwing. */
        missing?(names: readonly string[]): Promise<string[]>;
    };
    prepareRepository(request: RepositoryRequest): Promise<string>;
    progress?(message: string): void;
    validate?(document: Mapping): Promise<void>;
    serviceImages?(
        inventory: InventoryEntry[],
        selections: ImageSelections,
    ): Promise<Record<string, string>>;
}

export async function projectName(
    fs: ProjectFs,
    env: NodeJS.ProcessEnv,
    project: string,
    fallback: string,
) {
    if (env.COMPOSE_PROJECT_NAME) return env.COMPOSE_PROJECT_NAME;
    const dotenv = await optionalFile(fs, join(project, '.env'));
    const configured = dotenv?.match(
        /^\s*COMPOSE_PROJECT_NAME\s*=\s*["']?([a-z0-9][a-z0-9_-]*)["']?\s*$/m,
    );
    if (configured) return configured[1]!;
    const existing = await optionalFile(
        fs,
        join(project, 'docker-compose.yaml'),
    );
    const name: unknown = existing ? parse(existing)?.name : undefined;
    return typeof name === 'string' ? name : fallback;
}

export async function projectIdentity(
    directory: string,
    dependencies: Pick<ProjectDependencies, 'fs' | 'env'>,
) {
    if (!isAbsolute(directory))
        throw new ProjectError('Project directory must be absolute');
    const projectDirectory = await dependencies.fs.realpath(directory);
    const fallback = basename(projectDirectory)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/^[^a-z0-9]+/, '');
    const name = await projectName(
        dependencies.fs,
        dependencies.env,
        projectDirectory,
        fallback,
    );
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name))
        throw new ProjectError(`Invalid Compose project name: ${name}`);
    return { projectDirectory, projectName: name };
}

/** Uses `repositories/<service>` when present; otherwise clones it non-interactively. */
export function cloneRepository(
    fs: ProjectFs,
    run: CommandRunner,
    env: NodeJS.ProcessEnv,
) {
    return async ({ service, directory, url, branch }: RepositoryRequest) => {
        try {
            if (!(await fs.stat(directory)).isDirectory())
                throw new ProjectError(
                    `repositories/${service} is not a directory`,
                );
            return await fs.realpath(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (
            typeof url !== 'string' ||
            !/^(git@github\.com:|https:\/\/github\.com\/)[\w./-]+(?:\.git)?$/.test(
                url,
            )
        ) {
            throw new ProjectError(
                `Development repository for ${service} is missing and has no supported chs.repository.url`,
            );
        }
        await fs.mkdir(dirname(directory), { recursive: true, mode: 0o700 });
        await run(
            'git',
            [
                'clone',
                ...(typeof branch === 'string' && branch
                    ? ['--branch', branch]
                    : []),
                '--',
                url,
                directory,
            ],
            {
                ...env,
                GIT_TERMINAL_PROMPT: '0',
                GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
            },
        );
        return directory;
    };
}

const withSshSecrets = (spec: Mapping, definition: ServiceDefinition) => {
    if (definition.labels['chs.local.builder.requiresSecrets'] === 'true')
        spec.secrets = [
            ...new Set([
                ...(spec.secrets ?? []),
                'ssh-private-key',
                'ssh-private-key-passphrase',
            ]),
        ];
    return spec;
};

function requireBuilder(
    service: string,
    definition: ServiceDefinition,
): string {
    const builder = definition.labels['chs.local.builder'];
    if (typeof builder !== 'string' || !builder)
        throw new ProjectError(
            `Development service ${service} does not declare a builder`,
        );
    if (!/^[a-zA-Z0-9_.-]+$/.test(builder))
        throw new ProjectError(`Invalid development builder for ${service}`);
    return builder;
}

function repositorySpec(
    service: string,
    definition: ServiceDefinition,
    original: Mapping,
    repository: string,
): Mapping {
    const context = resolve(
        repository,
        String(definition.labels['chs.local.repoContext'] ?? '.'),
    );
    const relativeContext = relative(repository, context);
    if (
        relativeContext === '..' ||
        relativeContext.startsWith('../') ||
        isAbsolute(relativeContext)
    ) {
        throw new ProjectError(
            `Development repository context for ${service} must remain inside the repository`,
        );
    }
    const dockerfile = definition.labels['chs.local.dockerfile'];
    original.build = { context, ...(dockerfile ? { dockerfile } : {}) };
    original.pull_policy = 'build';
    return { [service]: withSshSecrets(original, definition) };
}

async function builderTemplate(
    fs: ProjectFs,
    project: string,
    service: string,
    repository: string,
    builder: string,
): Promise<Mapping> {
    const builderDirectory = join(project, 'local/builders', builder);
    const version = (await fs.readdir(builderDirectory))
        .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
        .sort(
            (a, b) => Number(b.name.slice(1)) - Number(a.name.slice(1)),
        )[0]?.name;
    let template = await fs.readFile(
        join(builderDirectory, version ?? '', 'builder.docker-compose.yaml'),
    );
    for (const [token, value] of Object.entries({
        '<service>': service,
        '<absolute_repository_path>': repository,
        '<absolute_chs_dev_root>': project,
        '<chs_dev_root>': project,
    }))
        template = template.split(token).join(value);
    const generated: unknown = parse(template);
    if (
        !mapping(generated) ||
        !mapping(generated.services) ||
        !mapping(generated.services[service])
    )
        throw new ProjectError(
            `Invalid development builder template ${builder}`,
        );
    return generated;
}

async function developmentSpec(
    service: string,
    definition: ServiceDefinition,
    project: string,
    output: string,
    dependencies: ProjectDependencies,
): Promise<Mapping> {
    const builder = requireBuilder(service, definition);
    const repository = await dependencies.prepareRepository({
        service,
        directory: join(project, 'repositories', service),
        url: definition.labels['chs.repository.url'],
        branch: definition.labels['chs.repository.branch'],
    });
    const original = structuredClone(definition.spec);
    normalizePaths(original, dirname(definition.source), output);
    if (builder === 'repository')
        return repositorySpec(service, definition, original, repository);
    const generated = await builderTemplate(
        dependencies.fs,
        project,
        service,
        repository,
        builder,
    );
    const languageVersion =
        definition.labels['chs.local.builder.languageVersion'];
    for (const spec of Object.values(generated.services as Mapping)) {
        normalizePaths(spec, project, output);
        if (mapping(spec.build)) {
            spec.build.args = {
                ...spec.build.args,
                ...(languageVersion
                    ? { LANGUAGE_MAJOR_VERSION: languageVersion }
                    : {}),
            };
        }
    }
    const spec = merge(original, generated.services[service]);
    return {
        ...generated.services,
        [service]: withSshSecrets(spec, definition),
    };
}

async function validateEnvFiles(
    fs: ProjectFs,
    service: string,
    spec: Mapping,
): Promise<void> {
    for (const file of spec.env_file ?? []) {
        if (typeof file !== 'string' && file.required === false) continue;
        const path = typeof file === 'string' ? file : file.path;
        await fs.access(path).catch(() => {
            throw new ProjectError(
                `Environment file for ${service} is missing: ${path}`,
            );
        });
    }
}

async function validateResourceFile(
    fs: ProjectFs,
    service: string,
    kind: string,
    name: string,
    file: string,
) {
    try {
        await fs.access(file);
    } catch {
        throw new ProjectError(`File for ${kind} ${name} is missing: ${file}`);
    }
}

async function validateReferences(
    fs: ProjectFs,
    service: string,
    document: Mapping,
    spec: Mapping,
): Promise<void> {
    for (const kind of ['secrets', 'configs'] as const) {
        for (const reference of spec[kind] ?? []) {
            const name =
                typeof reference === 'string' ? reference : reference.source;
            const resource = document[kind]?.[name];
            if (!resource)
                throw new ProjectError(
                    `Prepared service ${service} references missing ${kind} ${name}`,
                );
            if (resource.file)
                await validateResourceFile(
                    fs,
                    service,
                    kind,
                    name,
                    resource.file,
                );
        }
    }
}

/** Checks the generated document references only files and resources that exist. */
export async function validateDocument(fs: ProjectFs, document: Mapping) {
    const services = Object.entries((document.services ?? {}) as Mapping);
    if (!services.length)
        throw new ProjectError('Prepared project has no services');
    for (const [service, spec] of services) {
        if (!spec.image && !spec.build)
            throw new ProjectError(
                `Prepared service ${service} has neither image nor build`,
            );
        await validateEnvFiles(fs, service, spec);
        await validateReferences(fs, service, document, spec);
    }
}

export interface ProjectRequest {
    projectDirectory: string;
    /** The `.chs-dev.yaml` revision to resolve. */
    configuration: string;
    /** Whether learned usage modes apply to the selection. */
    usageCache?: boolean;
    mockRuntimeDirectory?: string;
}

/** Resolves the effective service inventory without writing anything. */
export async function resolveProject(
    request: ProjectRequest,
    dependencies: Pick<ProjectDependencies, 'fs' | 'env'>,
) {
    const identity = await projectIdentity(
        request.projectDirectory,
        dependencies,
    );
    const state = readState(request.configuration);
    const { definitions } = await loadDefinitions(
        identity.projectDirectory,
        dependencies.fs,
    );
    const journey = await selectedJourney(
        identity.projectDirectory,
        state.journey,
        dependencies.fs,
    );
    const usage = await loadUsagePolicy(
        identity.projectDirectory,
        request.usageCache,
        dependencies.fs,
    );
    const inventory = resolveServices(definitions, state, journey, usage);
    return {
        ...identity,
        configurationIdentity: createHash('sha256')
            .update(request.configuration)
            .digest('hex'),
        inventory,
        sshRequirements: resolveSshRequirements(definitions, inventory),
    };
}

/**
 * Generates a self-contained Compose file for the configuration in `outputDirectory`.
 * The project directory is only read, except for cloning missing `repositories/<service>`.
 */
interface PrepareContext {
    project: string;
    output: string;
    dependencies: ProjectDependencies;
    mockDirectory: string;
    images: Record<string, string>;
}

async function resolveOutput(
    fs: ProjectFs,
    request: ProjectRequest & { outputDirectory: string },
    project: string,
): Promise<string> {
    const output = join(
        await fs.realpath(dirname(request.outputDirectory)),
        basename(request.outputDirectory),
    );
    if (output === project || !relative(output, project).startsWith('..'))
        throw new ProjectError('Output directory must not contain the project');
    return output;
}

async function generateServices(
    document: Mapping,
    sources: Record<string, string>,
    inventory: readonly InventoryEntry[],
    definitions: Definitions,
    context: PrepareContext,
): Promise<void> {
    const { project, output, dependencies, mockDirectory } = context;
    await prepareMockBootstrap(inventory, mockDirectory, dependencies.fs);
    const progress = dependencies.progress ?? (() => {});
    for (const item of inventory) {
        progress(`Preparing service ${item.service} (${item.mode})`);
        if (item.service === mockRuntimeService) {
            document.services[item.service] = await microcksSpec();
            sources[item.service] = join(mocksDirectory, 'catalogue.json');
            continue;
        }
        const definition = definitions.get(item.service)!;
        const generated = item.mockScenario
            ? {
                  [item.service]: await mockProviderSpec(
                      item,
                      definition,
                      mockDirectory,
                      dependencies.fs,
                  ),
              }
            : item.mode === 'Development'
              ? await developmentSpec(
                    item.service,
                    definition,
                    project,
                    output,
                    dependencies,
                )
              : { [item.service]: structuredClone(definition.spec) };
        for (const [service, spec] of Object.entries(generated)) {
            if (document.services[service])
                throw new ProjectError(
                    `Generated service name collision: ${service}`,
                );
            if (item.mode !== 'Development')
                normalizePaths(spec, dirname(definition.source), output);
            applyImagePin(spec, item.mode, context.images[service]);
            spec.labels = {
                ...labels(spec.labels),
                'chs.dev.mode': item.mode,
                'chs.dev.owner-service': item.service,
            };
            document.services[service] = spec;
            sources[service] = definition.source;
        }
    }
}

function applyImagePin(
    spec: Mapping,
    mode: InventoryEntry['mode'],
    image?: string,
) {
    if (mode !== 'Service' || !image) return;
    spec.image = image;
}

function pruneDependencies(document: Mapping): void {
    const selected = new Set(Object.keys(document.services));
    for (const spec of Object.values(document.services as Mapping)) {
        if (Array.isArray(spec.depends_on)) {
            spec.depends_on = spec.depends_on.filter((service: string) =>
                selected.has(service),
            );
        } else if (spec.depends_on) {
            spec.depends_on = Object.fromEntries(
                Object.entries(spec.depends_on).filter(([service]) =>
                    selected.has(service),
                ),
            );
        }
    }
}

/**
 * Publishes each routed service's load-balancer port to the host on the
 * loopback interface, so the daemon-hosted proxy (src/proxy) can reach the
 * same upstreams Traefik reaches from inside the docker network. Host ports
 * are ephemeral to avoid collisions; an already-published load-balancer port
 * is left untouched.
 */
function exposeIngressPorts(document: Mapping): void {
    const routed = routedServices(document);
    const allocated = new Set<number>();
    for (const entry of routed) {
        for (const router of entry.routers.routers) {
            const port =
                entry.routers.ports[router.service ?? router.name] ??
                fallbackContainerPort(entry.spec);
            if (port === undefined || entry.published.has(port)) continue;
            entry.published.add(port);
            const host = allocateHostPort(entry.service, allocated);
            entry.spec.ports = [
                ...(Array.isArray(entry.spec.ports) ? entry.spec.ports : []),
                `127.0.0.1:${host}:${port}`,
            ];
        }
    }
}

function routedServices(document: Mapping) {
    return Object.entries(document.services as Mapping)
        .map(([service, spec]) => ({
            service,
            spec,
            routers: routerLabels(labels(spec.labels)),
            published: publishedContainerPorts(spec),
        }))
        .filter((entry) => entry.routers.routers.length > 0)
        .sort((a, b) => a.service.localeCompare(b.service));
}

/**
 * Deterministic loopback host port derived from the service name, so
 * repeated preparations agree and container set changes rarely move ports.
 */
function allocateHostPort(service: string, used: Set<number>): number {
    let candidate = 20000 + (fnv1a(service) % 20000);
    while (used.has(candidate))
        candidate = candidate >= 39999 ? 20000 : candidate + 1;
    used.add(candidate);
    return candidate;
}

function fnv1a(text: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function publishedContainerPorts(spec: Mapping): Set<number> {
    const entries = Array.isArray(spec.ports)
        ? spec.ports
        : spec.ports
          ? [spec.ports]
          : [];
    const ports = new Set<number>();
    for (const entry of entries) {
        const port = publishedPortOf(entry);
        if (port !== undefined) ports.add(port);
    }
    return ports;
}

function publishedPortOf(entry: unknown): number | undefined {
    if (typeof entry === 'number') return entry;
    if (typeof entry === 'string') {
        return validPort(Number(entry.split(':').at(-1)!.split('/')[0]));
    }
    if (entry && typeof entry === 'object' && 'target' in entry)
        return validPort(Number((entry as { target: unknown }).target));
    return undefined;
}

function validPort(value: number): number | undefined {
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function fallbackContainerPort(spec: Mapping): number | undefined {
    const exposed = Array.isArray(spec.expose) ? spec.expose : [];
    const first = Number(exposed[0]);
    if (Number.isFinite(first) && first > 0) return first;
    return publishedContainerPorts(spec).values().next().value;
}

function wireProxy(document: Mapping): void {
    const proxy = document.services['ingress-proxy'];
    if (!proxy) return;
    proxy.depends_on = Object.fromEntries(
        Object.entries(document.services as Mapping)
            .filter(
                ([service, spec]) =>
                    service !== 'ingress-proxy' &&
                    Object.keys(labels(spec.labels)).some((key) =>
                        key.startsWith('traefik.http.routers.'),
                    ),
            )
            .map(([service, spec]) => [
                service,
                {
                    condition: spec.healthcheck
                        ? 'service_healthy'
                        : 'service_started',
                    restart: spec.labels?.['chs.dev.mode'] !== 'Mock',
                },
            ]),
    );
}

const retiredProxyTarget = 'http://ingress-proxy';
const daemonProxyTarget = 'http://host.docker.internal';

/**
 * Services such as ERIC forward to the `ingress-proxy` container by name. With
 * that container retired they must reach the daemon proxy on the host instead,
 * so lazy start and idle accounting also cover their traffic.
 */
function retargetRetiredProxy(document: Mapping): void {
    if (document.services['ingress-proxy']) return;
    for (const spec of Object.values(document.services as Mapping)) {
        if (spec.environment === undefined) continue;
        spec.environment = retargetEnvironment(spec.environment);
    }
}

function retargetEnvironment(environment: unknown): unknown {
    if (Array.isArray(environment))
        return environment.map((entry) =>
            typeof entry === 'string' ? retargetEntry(entry) : entry,
        );
    if (!environment || typeof environment !== 'object') return environment;
    return Object.fromEntries(
        Object.entries(environment).map(([key, value]) => [
            key,
            value === retiredProxyTarget ? daemonProxyTarget : value,
        ]),
    );
}

function retargetEntry(entry: string): string {
    const index = entry.indexOf('=');
    if (index < 0 || entry.slice(index + 1) !== retiredProxyTarget)
        return entry;
    return `${entry.slice(0, index)}=${daemonProxyTarget}`;
}

async function writeArtifacts(
    fs: ProjectFs,
    output: string,
    document: Mapping,
): Promise<string> {
    const touch = join(output, '.touch');
    if (
        Object.values(document.services as Mapping).some((spec) =>
            spec.develop?.watch?.some((watch: Mapping) => watch.path === touch),
        )
    )
        await fs.writeFile(touch, '', { flag: 'wx', mode: 0o600 });
    const composeFile = join(output, 'docker-compose.yaml');
    await fs.writeFile(composeFile, stringify(document), {
        flag: 'wx',
        mode: 0o600,
    });
    return composeFile;
}

/**
 * Durable start (D5): reports which required variables are missing and
 * excludes the services they block — each owner plus its transitive
 * dependents — from the document and inventory, so the remaining services
 * start. Variables attributable to no service are reported unattributable.
 * Without the `missing` capability, or with nothing missing, this is a
 * no-op and `enforce` runs as before.
 */
async function excludeBlocked(
    document: Mapping,
    environment: ProjectDependencies['environment'],
    initialization: readonly string[],
    selection: { dependencies: ReadonlyMap<string, readonly string[]> },
    inventory: readonly InventoryEntry[],
): Promise<{
    requirements: string[];
    inventory: readonly InventoryEntry[];
    /** True when any required variable was missing: enforce is skipped. */
    engaged: boolean;
    exclusions?: PreparationExclusion[];
    unattributable?: string[];
}> {
    const requirements = [
        ...new Set([...requiredEnvironment(document), ...initialization]),
    ].sort();
    const missing = (await environment.missing?.(requirements)) ?? [];
    if (!missing.length) {
        await environment.enforce(requirements);
        return { requirements, inventory, engaged: false };
    }

    const attribution = attributeEnvironment(document, requirements);
    const blocked = blockedSet(
        missing,
        attribution,
        selection.dependencies,
        new Set(inventory.map((entry) => entry.service)),
    );
    const exclusions = Object.entries(blocked.blocked).map(
        ([variable, services]): PreparationExclusion => ({
            variable,
            services,
            cause: `${variable} is not set`,
            remediation: `Set ${variable} in this checkout's .env file, then apply the environment again.`,
        }),
    );
    const excluded = new Set(Object.values(blocked.blocked).flat());
    let filtered = inventory;
    let updated = requirements;
    if (excluded.size) {
        filtered = inventory.filter((entry) => !excluded.has(entry.service));
        for (const name of excluded) delete document.services[name];
        pruneDependencies(document);
        updated = [
            ...new Set([...requiredEnvironment(document), ...initialization]),
        ].sort();
    }
    return {
        requirements: updated,
        inventory: filtered,
        engaged: true,
        exclusions: exclusions.length ? exclusions : undefined,
        unattributable: blocked.unattributable.length
            ? blocked.unattributable
            : undefined,
    };
}

export async function prepareProject(
    request: ProjectRequest & { outputDirectory: string },
    dependencies: ProjectDependencies,
): Promise<PreparedProject> {
    const { fs } = dependencies;
    const progress = dependencies.progress ?? (() => {});
    if (!isAbsolute(request.outputDirectory))
        throw new ProjectError('Output directory must be absolute');
    const { projectDirectory: project, projectName: name } =
        await projectIdentity(request.projectDirectory, dependencies);
    const output = await resolveOutput(fs, request, project);
    const state = readState(request.configuration);
    progress('Loading service definitions');
    const { definitions, resources } = await loadDefinitions(project, fs);
    const journey = await selectedJourney(project, state.journey, fs);
    const usage = await loadUsagePolicy(project, request.usageCache, fs);
    const selection = resolveSelection(definitions, state, journey, usage);
    const inventory = withMockRuntime(selection.entries);
    const images =
        (await dependencies.serviceImages?.(inventory, state)) ??
        state.serviceImages ??
        {};
    // An exclusive directory prevents sharing artifacts between operations.
    await fs.mkdir(output, { mode: 0o700 });
    const document: Mapping = { name, services: {}, ...resources };
    const sources: Record<string, string> = {};
    await generateServices(document, sources, inventory, definitions, {
        project,
        output,
        dependencies,
        images,
        mockDirectory:
            request.mockRuntimeDirectory ?? join(output, 'mock-config'),
    });
    pruneDependencies(document);
    wireProxy(document);
    retargetRetiredProxy(document);
    exposeIngressPorts(document);
    const initialization = mockOnlyInventory(inventory)
        ? []
        : await initialize(fs, project, document);
    progress('Checking required environment');
    const durable = await excludeBlocked(
        document,
        dependencies.environment,
        initialization,
        selection,
        inventory,
    );
    const sshRequirements = resolveSshRequirements(
        definitions,
        durable.inventory,
    );
    progress('Validating referenced files');
    await (dependencies.validate ?? ((d) => validateDocument(fs, d)))(document);
    const composeFile = await writeArtifacts(fs, output, document);
    const prepared: PreparedProject = {
        protocolVersion: 1,
        projectName: name,
        projectDirectory: project,
        configurationIdentity: createHash('sha256')
            .update(request.configuration)
            .digest('hex'),
        composeFiles: [composeFile],
        sources,
        inventory: [...durable.inventory],
        sshRequirements,
        environmentRequirements: durable.requirements,
    };
    return withDurable(prepared, durable);
}

/** Attaches durable-start findings to the prepared project. */
function withDurable(
    prepared: PreparedProject,
    durable: {
        exclusions?: PreparationExclusion[];
        unattributable?: string[];
    },
): PreparedProject {
    if (durable.exclusions) prepared.exclusions = durable.exclusions;
    if (durable.unattributable) {
        prepared.unattributable = durable.unattributable;
    }
    return prepared;
}
