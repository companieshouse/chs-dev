import AbstractDevelopmentServiceCommand from "./AbstractDevelopmentServiceCommand.js";

export default class Disable extends AbstractDevelopmentServiceCommand {

    static description: string = "Removes a service from development mode";

    protected static action: string = "disable";

    protected async handleValidService (serviceName: string): Promise<boolean> {
        this.stateManager.excludeServiceFromLiveUpdate(serviceName);
        this.log(`Service "${serviceName}" is disabled`);

        return true;
    }

}
