import { getRepositoryDescription, getRespositoryOwner } from "../../helpers/github.js";
import Service from "../../model/Service.js";

export type Logger = (msg: string) => void;
export type ServiceGitDescriptionAndOwner = Service & {
    gitDescription: string;
    teamOwner: string;
};
export type ServiceFinder = (argument: string) => Service | ServiceGitDescriptionAndOwner | undefined;

const defaultServiceFinder: ServiceFinder = (_: string): Service | undefined => undefined;

export default abstract class AbstractDependencyGraph {

    protected serviceFinder: ServiceFinder = defaultServiceFinder;

    constructor (serviceFinder?: ServiceFinder) {
        this.serviceFinder = serviceFinder ?? defaultServiceFinder;
    }

    protected getServiceGitDescriptionAndOwner = (service: Service): ServiceGitDescriptionAndOwner => {
        const repoUrl = service.repository?.url;
        let gitDescription;
        let teamOwner;

        if (repoUrl) {
            const MuteError = true;
            const gitServiceName = repoUrl.replace(/\.git$/, "").split("/").pop() as string;
            gitDescription = service.module !== "infrastructure" && service.module !== "open-telemetry" ? getRepositoryDescription(gitServiceName, MuteError) : "infrastructure service";
            teamOwner = service.module !== "infrastructure" && service.module !== "open-telemetry" ? getRespositoryOwner(gitServiceName, MuteError) : "infrastructure service";
        }
        return {
            ...service,
            gitDescription: gitDescription ?? "Service Description Unavailable",
            teamOwner: teamOwner ?? "Service Owner Unavailable"
        };
    };

}
