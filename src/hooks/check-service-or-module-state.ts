import { Hook, Config } from "@oclif/core";
import load from "../helpers/config-loader.js";
import { StateManager } from "../state/state-manager.js";
import { confirm } from "../helpers/user-input.js";
import { matchExistInArrays, findUniqueItemsInParentArray } from "../helpers/index.js";

/**
 *  Hook that checks the state of a service or module before and after command execution.
 * Depending on the topic, it delegates to the appropriate handler function.
 *
 * @param {object} params - Hook parameters.
 * @param {string[]} params.activatedServices - List of currently activated services.
 * @param {string} params.topic - The topic of the command (e.g., "services", "modules", "exclusions", "development").
 * @param {string} params.command - The command being executed (e.g., "enable", "disable").
 * @param {string[]} params.commandArgv - The arguments passed to the command.
 * @param {Config} params.config - CLI configuration.
 * @param {any} params.context - CLI execution context.
 * @returns {Promise<string[]>} - Returns a list of warnings encountered during the hook execution.
 */
export const hook: Hook<"check-service-or-module-state"> = async ({
    activatedServices,
    topic,
    command,
    commandArgv,
    config,
    context
}): Promise<string | void> => {
    let handler: ((command: string, config: Config, context: any) => Promise <void | string>) | undefined;

    switch (topic) {
    case "services":
    case "modules":
        handler = handleServicesModulesTopic(activatedServices as string[]);
        break;
    case "exclusions":
    case "development":
        handler = handleDevelopmentExclusionsTopic(activatedServices as string[], commandArgv as string[]);
        break;

    }

    if (typeof handler !== "undefined") {
        return handler(command as string, config as Config, context);
    }

};

/**
 * Handles service/module-related commands by checking their state and ensuring consistency.
 * Checks the exclusion and liveupdate states and prompt user if state is in disarray with option to remove any services that may cause inconsistencies or potential issues.
 *
 * @param {string[]} activatedServices - List of currently activated services.
 * @returns {(command: string, config: Config, context: any) => Promise<void>} - A function that processes the command.
 */
const handleServicesModulesTopic = (activatedServices: string[]) =>
    async (command: string, config: Config, context) => {
        if (command === "enable" || command === "disable") {
            const chsDevConfig = load();

            const state = new StateManager(chsDevConfig.projectPath);
            const { snapshot: { servicesWithLiveUpdate, excludedServices } } = state;

            // Process live update services
            await processServiceGroup(
                servicesWithLiveUpdate,
                activatedServices,
                context,
                state,
                state.excludeServiceFromLiveUpdate,
                "LiveUpdate"
            );

            // Process excluded services
            await processServiceGroup(
                excludedServices,
                activatedServices,
                context,
                state,
                state.removeExclusionForService,
                "Excluded"
            );
        }
    };

/**
 * Handles exclusion and development-related commands.
 * Checks if services to be excluded or enabled for development state are already activated/enabled.
 * In event of warning, the message is stored into the warning variable.
 *
 * @param {string[]} activatedServices - List of currently activated services.
 * @param {string[]} commandArgv - Command arguments.
 * @returns {(command: string, config: Config, context: any) => Promise<void | string>} - A function that processes the command.
 */
const handleDevelopmentExclusionsTopic = (activatedServices: string[], commandArgv : string[]) =>
    async (command: string, config: Config, context) => {
        if (command === "enable" || command === "add") {

            const liveAndExcludedServicesNotActivated = findUniqueItemsInParentArray(commandArgv, activatedServices);

            if (liveAndExcludedServicesNotActivated.length) {
                const message = handleDevelopmentExclusionWarnings(liveAndExcludedServicesNotActivated);
                context.warn(message);
                return message;
            }
        }
    };

/**
 * Processes a group of services (LiveUpdate/Development mode or Excluded) and prompts for removal if they are not activated.
 *
 * @param {string[]} serviceGroup - The group of services to process.
 * @param {string[]} activatedServices - List of currently activated services.
 * @param {any} context - CLI execution context.
 * @param {StateManager} state - The state manager instance.
 * @param {(serviceName: string) => void} removeServiceFn - Function to remove a service from the group.
 * @param {string} label - The label describing the service type (e.g., "LiveUpdate", "Excluded").
 * @returns {Promise<void>}
 */
const processServiceGroup = async (serviceGroup, activatedServices, context, state, removeServiceFn, label) => {
    if (!serviceGroup.length) return;

    const serviceGroupNotActivated = !matchExistInArrays(serviceGroup, activatedServices);

    if (activatedServices.length === 0 || serviceGroupNotActivated) {
        const allServices = serviceGroup.join(",");
        context.warn(
            `The following ${label} services are currently not activated: "${allServices}". ` +
            `Remove all ${label} services to prevent corruption of chs-dev state.`
        );

        if (await handlePrompt()) {
            serviceGroup.forEach(serviceName => removeServiceFn.call(state, serviceName));
            context.log(`${label} services removed successfully.`);
        } else {
            context.warn(
                `${label} services that are not activated might cause chs-dev to malfunction.`
            );
        }
    } else {
        const notActivatedServiceGroupList = findUniqueItemsInParentArray(serviceGroup, activatedServices);

        for (const serviceName of notActivatedServiceGroupList) {
            context.warn(`Service: ${serviceName} is currently ${label} but not activated.`);

            if (await handlePrompt(serviceName)) {
                removeServiceFn.call(state, serviceName);
                context.log(`${serviceName} removed successfully.`);
            } else {
                context.warn(`Service: ${serviceName} might cause chs-dev to malfunction.`);
            }
        }
    }
};

/**
 * Prompts the user for confirmation before removing a service or all services.
 *
 * @param {string} [text="all"] - The name of the service to remove or "all" for multiple services.
 * @returns {Promise<string>} - The user's response ("yes" or "no").
 */
const handlePrompt = async (text = "all"): Promise<boolean> => {
    return await confirm(`Remove ${text}?`);
};

/**
 * Generates a warning message for services that are in development mode or excluded but not enabled.
 *
 * @param {string[]} services - List of services causing warnings.
 * @returns {string} - The generated warning message.
 */
const handleDevelopmentExclusionWarnings = (services: string[]): string => {
    return `Service(s): "${services.join(",")}" does not appear to be enabled and might cause chs-dev to malfunction. Run: 'chs-dev services enable ${services.join(" ")}', then rerun the previous command.`;
};

export default hook;
