import { existsSync, mkdirSync, writeFileSync } from "fs";
import Config from "../model/Config.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import { join } from "path";
import CONSTANTS from "../model/Constants.js";
import yaml from "yaml";

/**
 * Defines the type for the Options object passed to the
 * `generateDockerComposeForService` method
 */
type NewDockerComposeSpecOptions = {
    /**
     * Initial Docker Compose Spec file which is being constructed prior to the
     * customisations to make it the new service
     */
    initialSpecValue: DockerComposeSpec;

    /**
     * Allow the generator to replace a service specification which already
     * exists
     */
    force?: boolean;

    /**
     * Name of the container
     */
    containerName?: string;

    /**
     * Description of the new service
     */
    descriptionLabel?: string;

    /**
     * Traefik rule defining any routing to the new service
     */
    traefikRuleLabel?: string;

    /**
     * Traefik priority label value for the new service
     */
    traefikPriorityLabel?: string;

    /**
     * Default branch name for the service - if different from hte value
     * configured in GitHub
     */
    gitHubRepoBranchName?: string;
}

/**
 * Defines an object which determines which value for the label exists within
 * the options supplied with the purpose of handling the options supplied to
 * the method.
 */
type LabelOverride = {
    /**
     * An expression which identifies if the label should use the override
     */
    testExpression: RegExp;

    /**
     * Supplier of the value from the options when the label matches the
     * expression
     * @param options passed to the generator method
     * @returns value of option or undefined if the option has not been set
     */
    supplier: (options: NewDockerComposeSpecOptions) => string | undefined
}

const labelsToBeOverriddenMapping: Record<string, LabelOverride> = {
    "chs.repository.branch": {
        testExpression: /^chs\.repository\.branch/,
        supplier: options => options.gitHubRepoBranchName
    },
    "chs.description": {
        testExpression: /^chs\.description/,
        supplier: options => options.descriptionLabel
    },
    [`traefik.http.routers.${CONSTANTS.templatePlaceHolders.SERVICE_NAME}.rule`]: {
        testExpression: /^traefik\.http\.routers\.[^.]+\.rule/,
        supplier: options => options.traefikRuleLabel
    },
    [`traefik.http.routers.${CONSTANTS.templatePlaceHolders.SERVICE_NAME}.priority`]: {
        testExpression: /^traefik\.http\.routers\.[^.]+\.priority/,
        supplier: options => options.traefikPriorityLabel
    }
};

/**
 * Creates a Docker Compose Service Specification for the supplied service
 */
export class ServiceGenerator {

    // eslint-disable-next-line no-useless-constructor
    constructor (
        private readonly config: Config
    ) { }

    /**
     * Generates new Docker Compose Specification for the supplied service with
     * name `serviceName`. Options provide new values for the different properties
     * on the new service
     * @param serviceName Name of the new service being created
     * @param module Name of the module the new service belongs to
     * @param options defines the properties for the new service and a few
     *      additional settings required for generating the new service
     * @returns Generated Docker Compose Specification
     */
    generateDockerComposeSpecForService (
        serviceName: string,
        module: string,
        options: NewDockerComposeSpecOptions
    ) {
        const absoluteModulePath = join(
            this.config.projectPath, CONSTANTS.MODULES_DIRECTORY, module
        );

        const absoluteServiceSpecPath = join(
            absoluteModulePath, `${serviceName}.docker-compose.yaml`
        );

        if (!existsSync(absoluteModulePath)) {
            mkdirSync(absoluteModulePath);
        }

        if (!options.force && existsSync(absoluteServiceSpecPath)) {
            throw new Error(`Service: ${serviceName} already exists in ${module}`);
        }

        const composeSpec = options.initialSpecValue;

        if (!Object.keys(composeSpec.services).includes(serviceName)) {
            composeSpec.services[serviceName] = {};
        }

        composeSpec.services[serviceName].labels = this.amendLabels(composeSpec.services[serviceName].labels, serviceName, options);

        if (typeof options.containerName === "undefined") {
            delete composeSpec.services[serviceName].container_name;
        } else {
            composeSpec.services[serviceName].container_name = options.containerName;
        }

        const generatedSpec = yaml.stringify(composeSpec);

        writeFileSync(
            absoluteServiceSpecPath,
            Buffer.from(
                generatedSpec,
                "utf8"
            )
        );

        return generatedSpec;
    }

    private amendLabels (
        labels: string[] | Record<string, string> | undefined,
        serviceName: string,
        options: NewDockerComposeSpecOptions
    ): string[] | Record<string, any> {
        if (Array.isArray(labels)) {
            return labels.map(
                label => this.overrideLabel(label, serviceName, options)
            ).filter(label => typeof label !== "undefined");
        } else if (typeof labels !== "undefined") {
            return Object.entries(labels)
                .map(label => this.overrideLabel(label, serviceName, options) as string[] | undefined)
                .reduce((labelsAsRecord, label) => {
                    const [labelKey, labelValue] = label || [];

                    return {
                        ...labelsAsRecord,
                        [labelKey]: labelValue
                    };
                }, {});
        }

        return [];
    }

    private overrideLabel (
        labelValue: string | string[],
        serviceName: string,
        options: NewDockerComposeSpecOptions
    ) {
        const normaliseLabelKey = (labelKey: string) =>
            labelKey.replace(
                CONSTANTS.templatePlaceHolders.SERVICE_NAME, serviceName
            );

        const arrayAsInput = Array.isArray(labelValue);

        const labelStringToSearchWithin = arrayAsInput
            ? labelValue[0]
            : labelValue;

        const labelOverride = Object.entries(labelsToBeOverriddenMapping)
            .find(([_, potentialOverride]) => potentialOverride.testExpression.test(labelStringToSearchWithin));

        if (typeof labelOverride === "undefined") {
            return labelValue;
        } else {
            const [labelKey, override] = labelOverride;

            const value = override.supplier(options);

            if (typeof value !== "undefined") {
                return arrayAsInput
                    ? [normaliseLabelKey(labelKey), value]
                    : `${normaliseLabelKey(labelKey)}=${value}`;
            }
        }

        return undefined;
    }
}
