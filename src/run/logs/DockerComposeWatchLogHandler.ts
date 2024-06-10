import { AbstractLogHandler } from "./logs-handler.js";

export class DockerComposeWatchLogHandler extends AbstractLogHandler {

    private static readonly READY_TO_RELOAD_REGEX = /Watch configuration for service/;
    private static readonly REBUILD_SERVICE_REGEX = /Rebuilding\sservice\s+"([^"]*)"/;
    private static readonly SERVICE_RELOADED_REGEX = /Container\s([\dA-Za-z-]*)\s*(Started|Healthy)/;
    private servicesBeingReloaded: string[] = [];

    protected logToConsole (logEntries: string[]): void {
        logEntries.forEach((logEntry: string) => {
            if (this.verbose) {
                this.logger.log(logEntry);
            }

            if (logEntry.match(DockerComposeWatchLogHandler.READY_TO_RELOAD_REGEX)) {
                this.logger.log(
                    "Running services in development mode - watching for changes."
                );
                this.logger.log(
                    "Trigger an update to a service by running:\n\n"
                );
                this.logger.log(
                    "$ ./bin/chs-dev reload <service>\n\n"
                );
                return;
            }

            const rebuildServiceMatch = logEntry.match(DockerComposeWatchLogHandler.REBUILD_SERVICE_REGEX);

            if (rebuildServiceMatch !== null) {
                const [_, serviceName] = rebuildServiceMatch;

                this.servicesBeingReloaded = [
                    ...this.servicesBeingReloaded,
                    serviceName
                ];

                this.logger.log(`Reloading service: ${serviceName}`);

                return;
            }

            const rebuiltServiceMatch = logEntry.match(DockerComposeWatchLogHandler.SERVICE_RELOADED_REGEX);

            if (rebuiltServiceMatch !== null) {
                const [_, rebuiltServiceName] = rebuiltServiceMatch;

                if (this.servicesBeingReloaded.includes(rebuiltServiceName)) {
                    this.servicesBeingReloaded = this.servicesBeingReloaded.filter(name => name !== rebuiltServiceName);

                    this.logger.log(`Service: ${rebuiltServiceName} reloaded`);
                }
            }
        });
    }

}

export default DockerComposeWatchLogHandler;
