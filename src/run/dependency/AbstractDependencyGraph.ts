import { getRepositoryDescription, getRespositoryOwner } from "../../helpers/github.js";
import Service from "../../model/Service.js";

export type Logger = (msg: string) => void;
export type ServiceGitDescriptionAndOwner = Service & {
    gitDescription: string;
    teamOwner: string;
};
export type ServiceFinder = (argument: string) => Service | ServiceGitDescriptionAndOwner | undefined;

const defaultServiceFinder: ServiceFinder = (_: string): Service | undefined => undefined;

/**
 * Abstract base class for representing a dependency graph of services.
 * Provides mechanisms for finding services and retrieving their Git descriptions and owners.
 * @property serviceFinder - Utility for locating services, defaults to {@link defaultServiceFinder}.
 *
 * @param serviceFinder - Optional custom service finder to override the default.
 */
export default abstract class AbstractDependencyGraph {

    protected serviceFinder: ServiceFinder = defaultServiceFinder;

    constructor (serviceFinder?: ServiceFinder) {
        this.serviceFinder = serviceFinder ?? defaultServiceFinder;
    }

    /**
     * Retrieves the Git description and owner information for a given service.
     *
     * @param service - The service for which to obtain Git metadata.
     * @returns An object containing the service's properties, Git description, and team owner.
     *
     * @remarks
     * If the service's module is "infrastructure" or "open-telemetry", default values are used.
     * If the repository URL is unavailable, fallback values are provided.
     */
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
