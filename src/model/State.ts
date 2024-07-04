/**
 * Represents the state of the world for the environment
 */
export interface State {

    /**
     * list of module names of the modules the user has enabled
     */
    modules: string[];

    /**
     * list of the service names the user has enabled
     */
    services: string[];

    /**
     * list of the service names which are within development mode within the
     * environment
     */
    servicesWithLiveUpdate: string[];

    /**
     * list of service names which are removed from the deployed environment
     */
    excludedServices: string[];
}

export default State;
