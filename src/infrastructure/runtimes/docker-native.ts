import { realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import type { RuntimeProject } from '../../domain/runtime-strategy.js';
import type { ServiceStatus } from '../../domain/runtime.js';
import { DockerComposeStrategy } from './docker-compose.js';
import { NativeDockerRuntime } from '../native/runtime.js';
import { createProcessExecutor } from '../live-process.js';
import { LiveEnvironment } from '../live-environment.js';
import { awsProfile } from '../aws-status.js';
import { liveFiles } from '../live-files.js';
import { projectStateDirectory } from '../settings.js';
import { resolveDockerConnection } from '../native/docker.js';
import { containerStatus } from './docker-state.js';

export class DockerNativeStrategy extends DockerComposeStrategy {
    override readonly name = 'Docker / Native';
    private readonly sessions = new Map<string, NativeDockerRuntime>();
    private readonly projects = new Map<string, RuntimeProject>();
    override live(project: RuntimeProject): NativeDockerRuntime {
        const directory = realpathSync(project.directory);
        if (project.environment || !this.projects.has(directory))
            this.projects.set(directory, project);
        const projects = this.projects;
        let session = this.sessions.get(directory);
        if (!session) {
            const execute = createProcessExecutor();
            const fallback = new LiveEnvironment(
                execute,
                directory,
                () => process.env,
                awsProfile,
                liveFiles,
            );
            session = new NativeDockerRuntime({
                directory: directory,
                get projectName() {
                    return projects.get(directory)?.name ?? 'unverified';
                },
                stateDirectory: projectStateDirectory(directory),
                execute,
                get environment() {
                    return projects.get(directory)?.environment ?? fallback;
                },
            });
            this.sessions.set(directory, session);
        }
        return session;
    }
    protected override async registryEnvironment(signal?: AbortSignal) {
        const session = this.sessions.values().next().value;
        return session
            ? session.commandEnvironment(signal)
            : (
                  await resolveDockerConnection(
                      createProcessExecutor(),
                      process.cwd(),
                      process.env,
                      signal,
                  )
              ).environment;
    }
    protected override async containerEnvironment(
        project: RuntimeProject,
        signal?: AbortSignal,
    ) {
        return this.live(project).commandEnvironment(signal);
    }
    override async inspect(
        project: RuntimeProject,
        signal?: AbortSignal,
    ): Promise<Record<string, ServiceStatus>> {
        const directory = await realpath(project.directory);
        const snapshot = await this.live({ ...project, directory }).snapshot(
            signal,
        );
        return Object.fromEntries(
            snapshot.containers.map((c) => [
                c.service,
                c.kind === 'service' &&
                c.lifecycle === 'exited' &&
                c.exitCode === 0
                    ? 'Stopped'
                    : containerStatus({
                          Status: c.lifecycle,
                          Health: c.health ? { Status: c.health } : undefined,
                          ExitCode: c.exitCode,
                          OOMKilled: c.oomKilled,
                      }),
            ]),
        );
    }
}
