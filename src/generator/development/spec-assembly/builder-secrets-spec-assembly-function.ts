import { getInitialDockerComposeFile } from "../../../helpers/docker-compose-file.js";
import CONSTANTS from "../../../model/Constants.js";
import { SpecAssemblyFunction } from "./spec-assembly-function.js";

const builderSecretsSpecAssemblyFunction: SpecAssemblyFunction = (
    developmentDockerComposeSpec,
    {
        projectPath,
        service
    }
) => {
    if (service.metadata.secretsRequired === CONSTANTS.BOOLEAN_LABEL_TRUE_VALUE) {
        const dockerComposeSpec = getInitialDockerComposeFile(projectPath);

        if (typeof dockerComposeSpec.secrets !== "undefined") {
            const serviceSpec = developmentDockerComposeSpec.services[`${service.name}-builder`] || developmentDockerComposeSpec.services[service.name];

            for (const secretName of Object.keys(dockerComposeSpec.secrets)) {
                if (typeof serviceSpec.secrets === "undefined") {
                    serviceSpec.secrets = [];
                }

                serviceSpec.secrets.push(
                    secretName
                );
            }
        }
    }
};

export default builderSecretsSpecAssemblyFunction;
