import {
    LiveController,
    type LiveDependencies,
} from '../application/live-controller.js';
import type { RuntimeStrategy } from '../domain/runtime-strategy.js';
import type { ServiceGroup } from '../domain/services.js';
import { awsProfile, readAwsStatus } from './aws-status.js';
import { configurationStore, liveFiles, projectLock } from './live-files.js';
import { createProcessExecutor } from './live-process.js';
import { LiveEnvironment } from './live-environment.js';
import { ProjectPreparation } from '../project/preparation.js';
import { SshSetupService, sshSetupFiles } from './ssh-setup.js';
import { tuiLog } from './tui-log.js';
import { activeSettings, projectStateDirectory } from './settings.js';
import type { ServiceVersions } from './service-versions.js';

export function createLiveSession(
    runtime: RuntimeStrategy,
    directory: string,
    groups: ServiceGroup[],
    options: Partial<Pick<LiveDependencies, 'initialIntent' | 'lock'>> & {
        versions?: ServiceVersions;
    } = {},
) {
    if (!runtime.capabilities.apply || !runtime.live)
        throw new Error(`${runtime.name} cannot be controlled from chs-dev.`);
    const execute = createProcessExecutor();
    const state = projectStateDirectory(directory);
    const environment = new LiveEnvironment(
        execute,
        directory,
        () => process.env,
        awsProfile,
        liveFiles,
    );
    const preparation = new ProjectPreparation({
        directory,
        stateDirectory: state,
        files: liveFiles,
        execute,
        environment,
        usageCache: () => activeSettings().usageCache.value,
        serviceImages: options.versions
            ? (context) => (inventory, selections) =>
                  options.versions!.images(
                      inventory,
                      selections,
                      context.signal,
                      (message) =>
                          context.onOutput?.({
                              stream: 'stderr',
                              text: message,
                          }),
                  )
            : undefined,
    });
    const ssh = new SshSetupService({
        directory,
        execute,
        files: sshSetupFiles,
        artifacts: state,
    });
    return new LiveController({
        eventSink: (event, fields) => tuiLog?.write(event, fields),
        operation: (work) => tuiLog?.scope(work) ?? work(),
        runtime: runtime.live({
            directory,
            environment,
            get name() {
                return preparation.projectName;
            },
        }),
        preparation,
        configuration: configurationStore(directory, groups, liveFiles, () =>
            Boolean(activeSettings().usageCache.value),
        ),
        verifyAws: readAwsStatus,
        ssh,
        lock: projectLock(state, liveFiles),
        clock: {
            now: () => new Date(),
        },
        ...options,
    });
}

export async function closeLiveSession(controller: LiveController) {
    await controller.shutdown();
}
