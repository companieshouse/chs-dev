import { OrNull } from "./OrNull.js";

/**
 * Represents a service within the development environment. A service is a
 * single deployable unit - typically container.
 */
export interface Service {
    /**
     * Meaningful name for service, unique within the environment
     */
    name: string;

    /**
     * Name of the module which the service resides
     */
    module: string;

    /**
     * Human readable description of the service
     */
    description?: OrNull<string>;

    /**
     * Path to the Docker Compose file for the service
     */
    source: string;

    /**
     * List of services names (exhaustive) that the service depends on.
     *
     * This will include all of the direct and indirect/transitive dependencies
     * the service has.
     */
    dependsOn: string[];

    /**
     * Details about the code repository for the service (required for
     * development mode)
     */
    repository: OrNull<{ url: string; branch?: string | null; }>;

    /**
     * When supplied will specify a common Dockerfile to use to build the
     * service for development mode
     */
    builder: string;

    /**
     * Other pertinent information about the service which may vary
     * service to service.
     */
    metadata: Record<string, OrNull<string> | undefined>;
}

export default Service;
