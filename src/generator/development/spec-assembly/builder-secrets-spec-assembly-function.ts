import getInitialDockerComposeFile from "../../../helpers/initial-docker-compose-file.js";
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
            for (const secretName of Object.keys(dockerComposeSpec.secrets)) {
                if (typeof developmentDockerComposeSpec.services[`${service.name}-builder`].secrets === "undefined") {
                    developmentDockerComposeSpec.services[`${service.name}-builder`].secrets = [];
                }

                // When it was previously unset is set above
                // @ts-expect-error
                developmentDockerComposeSpec.services[`${service.name}-builder`].secrets.push(
                    secretName
                );
            }
        }
    }
};

export default builderSecretsSpecAssemblyFunction;
