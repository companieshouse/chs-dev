import { existsSync, mkdirSync, writeFileSync } from "fs";
import Config from "../model/Config.js";
import { DockerComposeSpec } from "../model/DockerComposeSpec.js";
import { join } from "path";
import CONSTANTS from "../model/Constants.js";
import yaml from "yaml";

type NewDockerComposeSpecOptions = {
    initialSpecValue: DockerComposeSpec,
    force?: boolean,
    containerName?: string,
    descriptionLabel?: string,
    traefikRuleLabel?: string,
    traefikPriorityLabel?: string,
    gitHubRepoBranchName?: string
}

type LabelOverride = {
    testExpression: RegExp,
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

export class ServiceGenerator {

    // eslint-disable-next-line no-useless-constructor
    constructor (
        private readonly config: Config
    ) { }

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
