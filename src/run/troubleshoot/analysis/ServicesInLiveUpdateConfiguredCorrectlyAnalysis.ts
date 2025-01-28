import { join } from "path";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";
import { existsSync } from "fs";
import Service from "../../../model/Service.js";
import Config from "../../../model/Config.js";
import { getBuilders } from "../../../state/builders.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";

const ANALYSIS_HEADLINE = "Check for services in development mode correctly configured";
const REPOSITORY_BUILDER_MISSING_DOCKERFILE_TITLE = "Missing Dockerfile for service in Development mode without builder label";
const INCORRECT_BUILDER_TITLE = "Incorrect Builder defined for service in development mode";

const REPOSITORY_BUILDER_DOCKERFILE_SUGGESTIONS = [
    "Provide a valid value for the builder label",
    "Create a Dockerfile"
];

const DOCUMENTATION_LINKS = [
    "troubleshooting-remedies/correctly-setup-repository-builder.md",
    "troubleshooting-remedies/correctly-setup-builder.md"
];

/**
 * An analysis task which checks whether the services currently in development
 * mode are correctly configured with a Dockerfile - either from the builder
 * label or whether the repository itself has a Dockerfile within it.
 */
export default class ServicesInLiveUpdateConfiguredCorrectlyAnalysisextends extends BaseAnalysis {

    async analyse ({ inventory, stateManager, config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const servicesInLiveUpdate = inventory.services.filter(
            ({ name }) => stateManager.snapshot.servicesWithLiveUpdate.includes(name)
        );

        const issues: AnalysisIssue[] = servicesInLiveUpdate
            .map(service => this.analyseService(service, config))
            .filter(issueOrUndefined => typeof issueOrUndefined !== "undefined") as AnalysisIssue[];

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, "Warn");
    }

    private analyseService (service: Service, config: Config) {
        const isRepo = service.builder === "repository" || service.builder.replaceAll(/\s/g, "") === "";
        let issue: AnalysisIssue | undefined;
        if (isRepo) {
            if (!this.repositoryDockerfileExists(config, service)) {
                issue = this.createIssue(
                    REPOSITORY_BUILDER_MISSING_DOCKERFILE_TITLE,
                    `Missing Dockerfile for service ${service.name}`,
                    REPOSITORY_BUILDER_DOCKERFILE_SUGGESTIONS,
                    DOCUMENTATION_LINKS
                );

            }
        } else {
            if (!this.builderExists(config, service.builder)) {
                issue = this.createIssue(
                    INCORRECT_BUILDER_TITLE,
                    `Service: ${service.name} contains an incorrect builder label: ${service.builder}`,
                    this.constructSuggestionsForIncorrectBuilder(config),
                    DOCUMENTATION_LINKS
                );
            }
        }
        return issue;
    }

    private constructSuggestionsForIncorrectBuilder (config: Config): string[] {
        return [
            `Provide a valid value for the builder label from: ${this.availableBuilders(config).join(", ")}`,
            "Remove the builder label and Produce a Dockerfile in the source"
        ];
    }

    private builderExists (config: Config, builderName: string) {
        return this.availableBuilders(config).includes(builderName);
    }

    private availableBuilders (config: Config) {
        return Object.keys(getBuilders(config.projectPath));
    }

    private repositoryDockerfileExists (config: Config, service: Service) {
        return existsSync(this.constructRepositoryDockerfilePath(config.projectPath, service));
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
