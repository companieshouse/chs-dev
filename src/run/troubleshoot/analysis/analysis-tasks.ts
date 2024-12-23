import AnalysisTask from "./AnalysisTask.js";
import DockerMemoryAnalysis from "./DockerMemoryAnalysis.js";
import ProxiesConfiguredCorrectlyAnalysis from "./ProxiesConfiguredCorrectlyAnalysis.js";
import ServicesInLiveUpdateConfiguredCorrectlyAnalysis from "./ServicesInLiveUpdateConfiguredCorrectlyAnalysis.js";

const analysisTasks: AnalysisTask[] = [
    new ServicesInLiveUpdateConfiguredCorrectlyAnalysis(),
    new ProxiesConfiguredCorrectlyAnalysis(),
    new DockerMemoryAnalysis()
];

export default analysisTasks;
