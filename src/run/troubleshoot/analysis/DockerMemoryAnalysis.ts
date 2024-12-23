import { collect, deduplicate } from "../../../helpers/array-reducers.js";
import {
    fetchDockerSettings,
    DockerSettings
} from "../../../helpers/docker-settings-store.js";
import Service from "../../../model/Service.js";
import { Inventory } from "../../../state/inventory.js";
import { StateManager } from "../../../state/state-manager.js";
import AnalysisOutcome from "./AnalysisOutcome.js";
import { AnalysisIssue, TroubleshootAnalysisTaskContext } from "./AnalysisTask.js";
import os from "os";

const ANALYSIS_HEADLINE = "Check docker's memory allocation size";

const DOCKER_MEMORY_SUGGESTIONS = [
    "Got to settings on Docker Desktop application",
    "Select the Resource tab - Advanced",
    "Add to Memory Limit using the slider"
];

export default class DockerMemoryAnalysis {

    static readonly ENABLED_SERVICE_COUNT_THRESHOLD:number = 10;
    static readonly ENABLED_RESOURCE_INTENSIVE_SERVICES :string[] = ["elasticsearch"];

    async analyse ({ inventory, stateManager, config }: TroubleshootAnalysisTaskContext): Promise<AnalysisOutcome> {
        const issues = this.checkDockerMemorySize(inventory, stateManager);

        return this.createOutcomeFrom(issues ? [issues] : []);
    }

    private createOutcomeFrom (issues: AnalysisIssue[]): AnalysisOutcome | PromiseLike<AnalysisOutcome> {
        return issues.length > 0 ? AnalysisOutcome.createWarning(ANALYSIS_HEADLINE, issues) : AnalysisOutcome.createSuccessful(ANALYSIS_HEADLINE);
    }

    checkDockerMemorySize (inventory: Inventory, stateManager:StateManager): AnalysisIssue | undefined {
        const result = fetchDockerSettings();
        const { MemoryMiB } = result as DockerSettings;
        const issues = result as AnalysisIssue;

        if (!issues.title) {
            const dockerMemoryInGB = Math.floor(MemoryMiB / 1024);
            const isBelow12GBMemory = dockerMemoryInGB < 12;

            if (isBelow12GBMemory) {
                const isAtLeastHalfMemory = this.isHalfAboveDeviceMemory(dockerMemoryInGB);

                if (!isAtLeastHalfMemory) {
                    return {
                        title: "Docker memory size is too low",
                        description: `Docker memory size is ${dockerMemoryInGB}GB. It should be atleast >=12GB or half the device RAM`,
                        suggestions: DOCKER_MEMORY_SUGGESTIONS,
                        documentationLinks: []
                    };
                }

                const enabledServices = this.getEnabledServices(inventory, stateManager);
                const enabledServiceCountAboveThreshold = enabledServices.length > DockerMemoryAnalysis.ENABLED_SERVICE_COUNT_THRESHOLD;
                const resourceIntensiveServiceEnabled = DockerMemoryAnalysis.ENABLED_RESOURCE_INTENSIVE_SERVICES.some((service: string) => enabledServices.includes(service));

                if (enabledServiceCountAboveThreshold || resourceIntensiveServiceEnabled) {
                    return {
                        title: "Docker memory size is too low",
                        description: `Docker memory size should be >=12GB, as resource intensive services may not run properly`,
                        suggestions: DOCKER_MEMORY_SUGGESTIONS,
                        documentationLinks: []
                    };
                }

            }
        } else {
            return issues;
        }

    }

    private getEnabledServices (inventory: Inventory, stateManager:StateManager): string[] {
        const state = stateManager.snapshot;
        return inventory.services
            .filter(service => state.modules.includes(service.module) || state.services.includes(service.name))
            .reduce(collect<string, Service>(service => [service.name, ...service.dependsOn || []]), [])
            .reduce(deduplicate, [])
            .sort();
    };

    private isHalfAboveDeviceMemory (dockerMemoryInGB: number):boolean {
        const totalDeviceMemoryInBytes = os.totalmem();
        const halfDeviceMemoryInGB = Math.floor((totalDeviceMemoryInBytes / (1024 ** 3)) / 2);
        return dockerMemoryInGB >= halfDeviceMemoryInGB;
    }

}
