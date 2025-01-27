import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { addToStage, checkoutExistingBranch, checkoutNewBranch, cloneRepo, commit, push } from "../../helpers/git.js";
import NewServiceSpec from "../../model/NewServiceSpec.js";
import { join } from "path";
import yaml from "yaml";

/**
 * A Repostitory for Service Specifications.
 */
export default class ServiceSpecRepository {

    // eslint-disable-next-line no-useless-constructor
    constructor (
        private readonly localDirectory: string,
        private readonly gitHubOrganisationName: string,
        private readonly repositoryName: string,
        private readonly branchName: string,
        private readonly serviceSpecPath: string,
        private readonly isPermanent: boolean = false
    ) { }

    /**
     * Creates a new Service Specification Repository. When CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY
     * is set uses this as the local directory otherwise uses the supplied local directory
     * @param localDirectory Directory to clone the repository/use for the repository
     * @param gitHubOrganisationName Name of the GitHub Organisation
     * @param repositoryName Name of the GitHub Repository
     * @param branchName Name of the branch to use
     * @param serviceSpecPath Path to the service specifications within the repository
     * @returns New Service Specification Repository
     */
    static create (
        localDirectory: string,
        gitHubOrganisationName: string,
        repositoryName: string,
        branchName: string,
        serviceSpecPath: string
    ) {
        if (typeof process.env.CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY !== "undefined") {
            return new ServiceSpecRepository(
                process.env.CHS_DEV_NEW_SERVICE_LOCAL_DIRECTORY,
                gitHubOrganisationName,
                repositoryName,
                branchName,
                serviceSpecPath,
                true
            );
        }

        return new ServiceSpecRepository(
            localDirectory,
            gitHubOrganisationName,
            repositoryName,
            branchName,
            serviceSpecPath
        );
    }

    /**
     * Clones the repository if it is not permanent otherwise
     * checks out the appropriate branch
     * @returns Promise<void> indicating the completion of the operation
     */
    load () {
        if (this.isPermanent) {
            return checkoutExistingBranch(
                this.localDirectory,
                this.branchName
            );
        }

        return cloneRepo({
            repositoryUrl: `git@github.com:${this.gitHubOrganisationName}/${this.repositoryName}`,
            branch: this.branchName,
            destinationPath: this.localDirectory
        });
    }

    /**
     * Checks out the new branch with name supplied
     * @param newBranchName name of the new branch
     * @returns Promise<void> indicating the completion of the operation
     */
    initialise (newBranchName: string) {
        return checkoutNewBranch(
            this.localDirectory,
            newBranchName
        );
    }

    /**
     * Returns the service specification for the given service name if it exists
     * otherwise returns undefined
     * @param serviceName of the service
     * @returns Promise<NewServiceSpec | undefined> the service specification if
     * it exists otherwise undefined
     */
    async get (serviceName: string): Promise<NewServiceSpec | undefined> {
        if (!this.initialised) {
            throw new Error("Cannot get service specification from uninitialised repository.");
        }

        let serviceSpec: NewServiceSpec | undefined;

        const serviceSpecFile = join(this.serviceSpecDirectoryPath, `${serviceName}.yaml`);

        if (existsSync(serviceSpecFile)) {
            const serviceSpecYaml = readFileSync(serviceSpecFile).toString("utf-8");

            serviceSpec = yaml.parse(serviceSpecYaml);
        }

        return serviceSpec;
    }

    /**
     * Appends the new service specification to the repository
     * @param serviceName Name of the service
     * @param newServiceSpec Service Specification to append
     * @returns Promise<NewServiceSpec> the new service specification
     */
    async put (serviceName: string, newServiceSpec: NewServiceSpec): Promise<NewServiceSpec> {
        const serviceSpecYaml = yaml.stringify(newServiceSpec);

        const serviceSpecFileName = `${serviceName}.yaml`;
        writeFileSync(
            join(this.serviceSpecDirectoryPath, serviceSpecFileName),
            serviceSpecYaml
        );

        await addToStage(
            this.localDirectory,
            join(this.serviceSpecPath, serviceSpecFileName)
        );

        return newServiceSpec;
    }

    /**
     * Creates a commit with the supplied message and pushes the changes
     * @param commitMessage details of the commit
     */
    async commitAndPush (...commitMessage: string[]) {
        await commit(
            this.localDirectory,
            ...commitMessage
        );

        await push(
            this.localDirectory
        );
    }

    /**
     * Tides up the repository by removing the local directory when
     * the repository is not permanent
     * @returns Promise<void> indicating the completion of the operation
     */
    close () {
        if (this.isPermanent) {
            return;
        }

        rmSync(
            this.localDirectory,
            {
                force: true,
                recursive: true
            }
        );
    }

    private get initialised (): boolean {
        return existsSync(this.serviceSpecDirectoryPath);
    }

    private get serviceSpecDirectoryPath (): string {
        return join(this.localDirectory, this.serviceSpecPath);
    }
}
