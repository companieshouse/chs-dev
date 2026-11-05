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
    resolveServices,
    resolveSshRequirements,
    type Definitions,
    type ServiceDefinition,
} from './resolve.js';

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
    /** Checks that every required name has a value. */
    environment(names: readonly string[]): Promise<void>;
    prepareRepository(request: RepositoryRequest): Promise<string>;
    progress?(message: string): void;
    validate?(document: Mapping): Promise<void>;
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
    const inventory = resolveServices(definitions, state);
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
    const { project, output, dependencies } = context;
    const progress = dependencies.progress ?? (() => {});
    for (const item of inventory) {
        progress(`Preparing service ${item.service} (${item.mode})`);
        const definition = definitions.get(item.service)!;
        const generated =
            item.mode === 'Development'
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
                    restart: true,
                },
            ]),
    );
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
    const inventory = resolveServices(definitions, state);
    const sshRequirements = resolveSshRequirements(definitions, inventory);
    // An exclusive directory prevents sharing artifacts between operations.
    await fs.mkdir(output, { mode: 0o700 });
    const document: Mapping = { name, services: {}, ...resources };
    const sources: Record<string, string> = {};
    await generateServices(document, sources, inventory, definitions, {
        project,
        output,
        dependencies,
    });
    pruneDependencies(document);
    wireProxy(document);
    const initialization = await initialize(fs, project, document);
    const environmentRequirements = [
        ...new Set([...requiredEnvironment(document), ...initialization]),
    ].sort();
    progress('Checking required environment');
    await dependencies.environment(environmentRequirements);
    progress('Validating referenced files');
    await (dependencies.validate ?? ((d) => validateDocument(fs, d)))(document);
    const composeFile = await writeArtifacts(fs, output, document);
    return {
        protocolVersion: 1,
        projectName: name,
        projectDirectory: project,
        configurationIdentity: createHash('sha256')
            .update(request.configuration)
            .digest('hex'),
        composeFiles: [composeFile],
        sources,
        inventory,
        sshRequirements,
        environmentRequirements,
    };
}
