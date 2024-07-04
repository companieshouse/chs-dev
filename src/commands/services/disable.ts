import AbstractServiceCommand from "../AbstractServiceCommand.js";

export default class Disable extends AbstractServiceCommand {

    static description = "Removes the supplied services and any unnecessary dependencies from the Docker environment";

    protected async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.excludeService(serviceName);

        this.log(`Service "${serviceName}" is disabled`);
    }

}
