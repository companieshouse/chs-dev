import { readFileSync } from "fs";
import path from "path";
import yaml from "yaml";
import { DockerComposeSpec } from "../../../model/DockerComposeSpec.js";
import { Inventory } from "../../../state/inventory.js";
import { StateManager } from "../../../state/state-manager.js";
import { ServiceLoader } from "../../service-loader.js";
import BaseAnalysis from "./AbstractBaseAnalysis.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";

type PortsMapper = Record<string, {serviceName:string, source:string}[]>;

const ANALYSIS_HEADLINE = "Checks the ports for conflicts in enabled services";

const DOCUMENTATION_LINKS = ["troubleshooting-remedies/correctly-change-docker-compose-conflict-ports.md"];

/**
 * An analysis task that evaluates whether the enabled services assigned ports overlaps.
 */
export default class PortAnalysis extends BaseAnalysis {

    /**
     * Analyzes the port numbers assigned to host machine in the docker compose file of enabled services are not in contention.
     *
     * This method evalutes the docker compose configuration of the enabled services for potential issues resulting from port conflicts or clashes. It generates a "Fail" outcome in an event of a clash.
     *
     * @returns {Promise<AnalysisOutcome>} A promise that resolves to an `AnalysisOutcome`, which contains: Fail issues if there are services assigned with same port numbers
     */
    async analyse ({ inventory, stateManager, config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const issues = await this.handleIssues(inventory, stateManager);

        return this.createOutcomeFrom(ANALYSIS_HEADLINE, issues, "Fail");

    }

    /**
     * Identifies and reports port conflicts in enabled services.
     *
     * @param inventory - The inventory of services.
     * @param stateManager - The state manager containing service snapshots.
     * @returns An `AnalysisIssue` if conflicts exist; otherwise, `undefined`.
    */
    private handleIssues (inventory: Inventory,
        stateManager: StateManager): AnalysisIssue | undefined {
        const clashedPortsDetails: PortsMapper = this.getClashedPortsServices(inventory, stateManager);

        if (!Object.keys(clashedPortsDetails).length) {
            return undefined;
        }

        const suggestions = Object.entries(clashedPortsDetails).map(([port, services]) => {
            const serviceInfo = services
                .map((item, index) => `${index + 1}. Service: ${item.serviceName},\n   Source: ${item.source}`)
                .join("\n   ");
            return `Change port ${port} in these services to a unique number:\n   ${serviceInfo}`;
        });

        return this.createIssue(
            "Some of the enabled services assigned port are in conflict",
            "Follow the suggestions and documentation links for a local fix.",
            suggestions,
            DOCUMENTATION_LINKS
        );

    }

    /**
     * Gets the conflicting ports in enabled services.
     *
     * @param inventory - The inventory of services.
     * @param stateManager - The state manager containing service snapshots.
     * @returns conflicting ports with the serviceName and file location. e.g
     * { '50085': [
     *          {
        *          serviceName: service-one,
        *          source: absolutePath/service-one.docker-compose.yaml
     *          },
     *          {
     *             serviceName: service-two,
    *              source: absolutePath/service-two.docker-compose.yaml
     *          },
     *        ]
     * }
    */
    private getClashedPortsServices (
        inventory: Inventory,
        stateManager: StateManager
    ): PortsMapper {
        const state = stateManager.snapshot;
        const serviceLoader = new ServiceLoader(inventory);

        const hostPortsMapper: PortsMapper = {};
        const clashedPortsMapper: PortsMapper = {};

        serviceLoader.loadServices(state).forEach((service) => {
            const dockerComposeFile: DockerComposeSpec = yaml.parse(
                readFileSync(service.source, "utf-8")
            );

            const serviceName = path.basename(service.source, ".docker-compose.yaml");
            const serviceDefinition = dockerComposeFile.services?.[serviceName];
            const servicePorts = serviceDefinition?.ports;

            if (servicePorts) {
                const hostPorts = this.extractHostPorts(servicePorts);

                // Track clashed ports
                this.trackClashedPorts(serviceName, service.source, hostPorts, hostPortsMapper, clashedPortsMapper);

            }

        });

        return clashedPortsMapper;
    }

    /**
     * Extracts the host ports from a service's port configuration.
     *
     * This function ensures the service's port definition is always treated as an array
     * and extracts only the host ports (the first part before `:`) from each entry.
     *
     * @param servicePorts - A single port (string) or an array of port mappings.
     * @returns An array of extracted host ports.
    */
    private extractHostPorts (servicePorts: string | string[]): string[] {
    // Ensure all ports definition are array format
        const portsArray = Array.isArray(servicePorts) ? servicePorts : [servicePorts];

        // Extract only the host ports
        return portsArray.map(port => port.split(":")[0]);
    }

    /**
     *  Tracks and map conflicting ports among enabled services.
    * @param serviceName - The name of the current service.
    * @param serviceSource - The file path to the service's `docker-compose.yaml`.
    * @param hostPorts - The list of host ports assigned to the service.
    * @param hostPortMapper - A map tracking all host ports used by enabled services.
    * @param clashedPortsMapper - A map storing details of conflicting ports.
     */
    private trackClashedPorts (
        serviceName: string,
        serviceSource: string,
        hostPorts: string[],
        hostPortMapper: PortsMapper,
        clashedPortsMapper: PortsMapper
    ): void {
        hostPorts.forEach(hostPort => {
            if (!hostPortMapper[hostPort]) {
                hostPortMapper[hostPort] = [];
            }

            hostPortMapper[hostPort] = [...hostPortMapper[hostPort], { serviceName, source: serviceSource }].filter((item, index, self) => self.findIndex(entry => entry.serviceName === item.serviceName) === index);

            if (hostPortMapper[hostPort].length > 1) {
                clashedPortsMapper[hostPort] = hostPortMapper[hostPort];
            }
        });
    }
}
