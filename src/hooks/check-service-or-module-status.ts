import { Hook, Config } from "@oclif/core";
import { Inventory } from "../state/inventory.js";
import load from "../helpers/config-loader.js";
import { StateManager } from "../state/state-manager.js";

export const hook: Hook<"check-service-or-module-status"> = async ({
    services,
    modules,
    topic,
    command,
    config,
    context
}) => {

    let handler: ((command: string, config: Config, context: any) => void) | undefined;

    switch (topic) {
    case "services":
        handler = handleServicesTopic(services as string[]);
        break;
    case "development":
        handler = handleDevelopmentTopic(services as string[]);
        break;
    case "modules":
        handler = handleModulesTopic(modules as string[]);
        break;
    }

    if (typeof handler !== "undefined") {
        handler(command as string, config as Config, context);
    }
};

const handleServicesTopic = (services: string[]) =>
    (command: string, config: Config, context) => {
        if (command === "enable") {
            const chsDevConfig = load();

            const { snapshot } = (new StateManager(chsDevConfig.projectPath));

            services.forEach(serviceName => {
                if (snapshot.servicesWithLiveUpdate.includes(serviceName)) {
                    context.warn(
                        `Service: ${serviceName} is currently in development mode; ` +
                        `run: 'chs-dev development disable ${serviceName}' to run ` +
                        "from the image held in the registry."
                    );
                }

                if (snapshot.excludedServices.includes(serviceName)) {
                    context.warn(
                        `Service: ${serviceName} is currently excluded and so enabling the ` +
                        "service has no effect. To remove the exclusion run " +
                        `'chs-dev exclusions remove ${serviceName}'`
                    );
                }
            });
        }
    };

const handleDevelopmentTopic = (serviceNames: string[]) =>
    (command: string, config: Config, context) => {
        if (command === "enable") {
            const chsDevConfig = load();

            const { snapshot } = (new StateManager(chsDevConfig.projectPath));
            const { services } = (new Inventory(chsDevConfig.projectPath, config.cacheDir));

            serviceNames.forEach((serviceName) => {
                if (!snapshot.services.includes(serviceName)) {
                    const enabledViaModule = snapshot.modules.flatMap(
                        moduleName => services.filter(
                            ({ module }) => module === moduleName
                        )
                    ).some(
                        service => service?.name === serviceName
                    );

                    if (!enabledViaModule) {
                        context.warn(
                            `Service: ${serviceName} does not appear to be enabled as a ` +
                            `service. Run: 'chs-dev services enable ${serviceName}' to ` +
                            "run this service in development mode."
                        );
                    }
                }
            });
        }
    };

const handleModulesTopic = (modules: string[]) =>
    (command: string, config: Config, context) => {
        if (command === "enable") {
            const chsDevConfig = load();
            const { services } = (new Inventory(chsDevConfig.projectPath, config.cacheDir));
            const { snapshot } = (new StateManager(chsDevConfig.projectPath));

            modules.forEach(
                moduleName => {
                    const excludedServices = services
                        .filter(
                            ({ name, module }) => module === moduleName && snapshot.excludedServices.includes(name)
                        )
                        .map(({ name }) => name)
                        .join(", ");

                    if (excludedServices !== "") {
                        context.warn(
                            `Module: ${moduleName} contains the services: ${excludedServices} which ` +
                        "has been excluded. Remove the exclusion if you require these " +
                        "services to be included. To remove run: " +
                        "'chs-dev exclusion remove <service>'"
                        );
                    }

                }
            );

        }
    };

export default hook;
