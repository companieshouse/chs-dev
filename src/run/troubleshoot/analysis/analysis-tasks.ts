import AnalysisTask from "./AnalysisTask.js";
import DockerMemoryAnalysis from "./DockerMemoryAnalysis.js";
import ECRLoginAnalysis from "./ECRLoginAnalysis.js";
import ProxiesConfiguredCorrectlyAnalysis from "./ProxiesConfiguredCorrectlyAnalysis.js";
import ServicesInLiveUpdateConfiguredCorrectlyAnalysis from "./ServicesInLiveUpdateConfiguredCorrectlyAnalysis.js";

const analysisTasks: AnalysisTask[] = [
    new ServicesInLiveUpdateConfiguredCorrectlyAnalysis(),
    new ProxiesConfiguredCorrectlyAnalysis(),
    new DockerMemoryAnalysis(),
    new ECRLoginAnalysis()
];

export default analysisTasks;
