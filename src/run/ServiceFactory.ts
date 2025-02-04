import serviceSpecPrompts from "./service-factory/prompts/index.js";
import buildServiceSpecFromUserInput from "./service-factory/build-service-spec.js";
import ServiceSpecRepository from "./service-factory/ServiceSpecRepository.js";
import { confirm } from "../helpers/user-input.js";
import NewServiceSpec from "../model/NewServiceSpec.js";
import yaml from "yaml";
import CONSTANTS from "../model/Constants.js";
import { createPullRequest } from "../helpers/github.js";
import { readFileSync } from "fs";

/**
 * ServiceFactory is responsible for creating new service specifications.
 */
export default class ServiceFactory {

    // eslint-disable-next-line no-useless-constructor
    constructor (private readonly serviceSpecRepository: ServiceSpecRepository) { }

    /**
     * For the supplied Service Name will create a new service specification. It
     * will initialise the repository and commit the new service specification
     * to its own branch before raising a pull request. However, it will not
     * perform the commit or pull request if the dryRun flag is set to true.
     * @param serviceName Name of the service to create
     * @param dryRun whether to perform the operation or just simulate it
     * @param file containing the service specification
     * @returns Promise<void> indicating the completion of the operation
     */
    async createNewService (serviceName: string, dryRun: boolean = false, file: string | undefined = undefined): Promise<void> {
        await this.serviceSpecRepository.load();

        try {
            const branchName = this.createBranchNameForService(serviceName);

            await this.serviceSpecRepository.initialise(branchName);

            const initialServiceSpec = await this.serviceSpecRepository.get(serviceName);

            const overrideServiceSpec: Partial<NewServiceSpec> | undefined = this.readInputFileServiceSpec(file);

            if (typeof initialServiceSpec !== "undefined") {
                if (!await confirm(`Are you sure you want to modify the existing service specification for service: ${serviceName}?`)) {
                    throw new Error(`The service: ${serviceName} already exists and was not modified.`);
                }
            }

            const builtServiceSpec = await this.buildServiceSpec(overrideServiceSpec, initialServiceSpec, serviceName);

            await this.serviceSpecRepository.put(serviceName, builtServiceSpec as NewServiceSpec);

            await this.submitNewServiceChanges(serviceName, builtServiceSpec, branchName, dryRun);
        } finally {
            this.serviceSpecRepository.close();
        }
    }

    private async submitNewServiceChanges (
        serviceName: string,
        builtServiceSpec: Partial<NewServiceSpec>,
        branchName: string,
        dryRun: boolean
    ) {
        if (dryRun) {
            this.displayDryRunServiceSpec(builtServiceSpec);

            return;
        }

        await this.serviceSpecRepository.commitAndPush(
            `Add new service: ${serviceName}`,
            `* Create new service specification for ${serviceName}`,
            "```json",
            JSON.stringify(builtServiceSpec, null, 2),
            "```"
        );

        await createPullRequest(
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_NAME,
            branchName,
            `Create new service specification for ${serviceName}`,
            CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_BRANCH
        );
    }

    private displayDryRunServiceSpec (builtServiceSpec: Partial<NewServiceSpec>) {
        console.log(
            `(dry-run) Would have committed and pushed ${CONSTANTS.NEW_SERVICE_SPECS_PATH}/${builtServiceSpec.name}.yaml with the following content:`
        );

        this.printCreatedNewServiceSpec(builtServiceSpec as NewServiceSpec);

        console.log(
            `(dry-run) would have opened a pull request to ${CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_NAME} into branch ${CONSTANTS.NEW_SERVICE_SPECS_REPOSITORY_BRANCH}`
        );
    }

    private async buildServiceSpec (
        overrideServiceSpec: Partial<NewServiceSpec> | undefined,
        initialServiceSpec: NewServiceSpec | undefined,
        serviceName: string
    ) {
        const serviceSpecBuilder = buildServiceSpecFromUserInput(serviceSpecPrompts);

        const builderInputAsInitialValue = {
            ...(initialServiceSpec || {
                name: serviceName
            })
        };

        const builderInput = typeof overrideServiceSpec === "undefined"
            ? builderInputAsInitialValue
            : {
                ...builderInputAsInitialValue,
                ...overrideServiceSpec
            };

        return await serviceSpecBuilder(builderInput);
    }

    private readInputFileServiceSpec (file: string | undefined): NewServiceSpec | undefined {
        let overrideServiceSpec: NewServiceSpec | undefined;

        if (typeof file !== "undefined") {
            overrideServiceSpec = yaml.parse(readFileSync(file).toString("utf-8"));

            if (typeof overrideServiceSpec !== "object") {
                throw new Error("Unable to parse yaml file");
            }

            const invalidOverrideKeys = this.listInvalidOverrideKeys(overrideServiceSpec);

            if (invalidOverrideKeys.length > 0) {
                throw new Error("Invalid override file, contains invalid keys: " + invalidOverrideKeys.join(", "));
            }
        }

        return overrideServiceSpec;
    }

    private createBranchNameForService (serviceName: string) {
        const date = new Date(Date.now());

        const dateLabel = date.toLocaleDateString(
            "en-CA", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        );

        return `feature/add-${serviceName.replace(/[^a-zA-Z0-9\-.]/g, "-").toLowerCase()}-${dateLabel}`;
    }

    private printCreatedNewServiceSpec (newServiceSpec: NewServiceSpec) {
        console.log(yaml.stringify(newServiceSpec));
    }

    private listInvalidOverrideKeys (overrideServiceSpec: Partial<NewServiceSpec>) {
        // Since name is provided by the user, it is a valid key
        const validPaths = [...serviceSpecPrompts.map(prompt => prompt.selector), ".name"];

        // Flatten the object to a list of paths
        const flattenObject = (initialPath: string, object: object): [string, any][] => {
            return Object.entries(object)
                .flatMap(([key, value]) => {
                    const path = initialPath === "." ? key : `${initialPath}.${key}`;

                    return typeof value === "object" ? flattenObject(path, value) : [[path, value]];
                });
        };

        return flattenObject(".", overrideServiceSpec)
            .filter(([path, value]) => typeof value !== "undefined" && !validPaths.includes(`.${path}`))
            .map(([path, _]) => path);
    }

}
