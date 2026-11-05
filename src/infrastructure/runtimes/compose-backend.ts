import {
    DockerLiveRuntime,
    type DockerLiveDependencies,
} from '../live-runtime.js';
import { namespace } from '../native/compiler.js';
import { LiveFailure, type PreparedProject } from '../../domain/live.js';
import type { OperationContext } from '../../domain/runtime-strategy.js';

/** Keep Compose delegation intact, but prevent it taking over a native checkout. */
export class ComposeBackend extends DockerLiveRuntime {
    constructor(private readonly connection: DockerLiveDependencies) {
        super(connection);
    }
    private async checkNative(context: OperationContext) {
        const result = await this.connection.execute({
            command: 'docker',
            args: [
                'ps',
                '--all',
                '--quiet',
                '--filter',
                `label=chs.dev.project=${namespace(await this.connection.realpath(this.connection.directory))}`,
                '--filter',
                'label=chs.dev.backend=native',
            ],
            cwd: this.connection.directory,
            env: await this.connection.environment.resolve([], context.signal),
            signal: context.signal,
            captureStdout: true,
            privateOutput: true,
        });
        if (result.code !== 0)
            throw new LiveFailure(
                'Cannot check native backend ownership.',
                'blocked',
            );
        if (result.stdout.trim())
            throw new LiveFailure(
                'Native containers still exist for this checkout. Stop the native environment before using Compose. Its data volumes will be kept.',
                'blocked',
            );
    }
    override async apply(project: PreparedProject, context: OperationContext) {
        await this.checkNative(context);
        return super.apply(project, context);
    }
    override async reload(
        project: PreparedProject,
        services: readonly string[],
        context: OperationContext,
    ) {
        await this.checkNative(context);
        return super.reload(project, services, context);
    }
}
