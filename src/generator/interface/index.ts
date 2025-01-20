import Service from "../../model/Service.js";

export interface LiveUpdate {
  liveUpdate: boolean;
}

export type ServiceWithLiveUpdate = Service & LiveUpdate;

export interface RunnableServicesObject {
    runnableServices: ServiceWithLiveUpdate[],
    infrastructureSources: string[]
}
