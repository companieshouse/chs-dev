import AbstractServiceCommand from "../AbstractServiceCommand.js";

export default class Enable extends AbstractServiceCommand {

    static description = "Enables the services and any dependencies for use within the Docker environment";

    protected async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.includeService(serviceName);

        this.log(`Service "${serviceName}" is enabled`);
    }

}
