import { existsSync } from "fs";
import { TroubleshootActionContext } from "./TroubleshootAction.js";
import { join } from "path";
import { confirm } from "../../../helpers/user-input.js";
import Service from "../../../model/Service.js";
import { provideLinkToDocumentaton } from "./documentation-prompt.js";
import { getBuilders } from "../../../state/builders.js";

/**
 * Checks the services in live update have the correct labels. Ensuring that
 * services which define the builder `repository` or that it is not supplied then
 * the repository contains a Dockerfile the service references otherwise checks
 * that the builder defined exists.
 */
export class CheckForServicesInLiveUpdateConfigured {

    private misconfiguredServiceNames: string[] | undefined = undefined;

    /**
     * Checks whether the services in live update are referencing Dockerfiles
     * which can be used to build Docker images for the service. Sets the
     * misconfiguredServiceNames to contain the services which are misconfigured
     * @param troubleshootActionContext - context for the action
     * @returns Promise representing whether all services in development mode
     * are correctly configured
     */
    autoTask ({ inventory, stateManager, config }: TroubleshootActionContext): Promise<boolean> {
        this.misconfiguredServiceNames = [];

        const servicesInLiveUpdate = inventory.services.filter(
            ({ name }) => stateManager.snapshot.servicesWithLiveUpdate.includes(name)
        );

        let overallResult = true;

        for (const service of servicesInLiveUpdate) {
            const builderPath = service.builder === "repository" || service.builder.replaceAll(/\s/g, "") === ""
                ? this.constructRepositoryDockerfilePath(config.projectPath, service)
                : join(config.projectPath, "local/builders", service.builder);

            if (!existsSync(builderPath)) {
                overallResult = false;

                this.misconfiguredServiceNames.push(service.name);
            }
        }

        return Promise.resolve(overallResult);
    }

    /**
     * Will prompt the user to determine the corrections required for the
     * incorrect services
     * @param troubleshootActionContext - context for the action
     * @returns
     */
    async getOutputViaPrompt ({
        inventory,
        stateManager,
        config
    }: TroubleshootActionContext): Promise<boolean> {
        if (typeof this.misconfiguredServiceNames === "undefined") {
            await this.autoTask({
                inventory,
                stateManager,
                config
            });
        }

        const problematicServices = inventory.services.filter(
            ({ name }) => this.misconfiguredServiceNames?.includes(name)
        );

        for (const problematicService of problematicServices) {
            const shouldUseBuilder = await confirm(
                `Should the service: ${problematicService.name} use a builder?`,
                {
                    defaultValue: false
                }
            );

            if (shouldUseBuilder) {
                const builders = Object.keys(getBuilders(config.projectPath));

                console.log(`
To setup the service: ${problematicService.name} to use a builder you need to add the label:
'chs.local.builder' to the service with the name of a builder from list:
 * ${builders.join("\n * ")}
`);
                provideLinkToDocumentaton("troubleshooting-remedies/correctly-setup-builder.md");
            } else {
                console.log(`
To continue using a repository as the source for the service: ${problematicService.name} you need to
construct a Dockerfile in the repository which is capable to building an image.`);

                provideLinkToDocumentaton("troubleshooting-remedies/correctly-setup-repository-builder.md");
            }
        }

        return problematicServices.length === 0 || await confirm(
            "Do you want to continue troubleshooting?",
            {
                defaultValue: true
            }
        );
    }

    private constructRepositoryDockerfilePath (projectPath: string, service: Service) {
        let path = join(projectPath, "repositories", service.name);

        if (service.metadata.repoContext !== null && typeof service.metadata.repoContext !== "undefined") {
            path = join(path, service.metadata.repoContext);
        }

        if (service.metadata.dockerfile !== null && typeof service.metadata.dockerfile !== "undefined") {
            path = join(path, service.metadata.dockerfile);
        } else {
            path = join(path, "Dockerfile");
        }

        return path;
    }
}

export default new CheckForServicesInLiveUpdateConfigured();
