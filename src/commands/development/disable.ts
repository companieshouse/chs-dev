import AbstractServiceCommand from "../AbstractServiceCommand.js";

export default class Disable extends AbstractServiceCommand {

    static description: string = "Removes a service from development mode";

    protected async handleValidService (serviceName: string): Promise<void> {
        this.stateManager.excludeServiceFromLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is disabled`);
    }

}
