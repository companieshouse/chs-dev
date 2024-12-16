import AnalysisTask from "./AnalysisTask.js";
import ProxiesConfiguredCorrectlyAnalysis from "./ProxiesConfiguredCorrectlyAnalysis.js";
import ServicesInLiveUpdateConfiguredCorrectlyAnalysis from "./ServicesInLiveUpdateConfiguredCorrectlyAnalysis.js";

const analysisTasks: AnalysisTask[] = [
    new ServicesInLiveUpdateConfiguredCorrectlyAnalysis(),
    new ProxiesConfiguredCorrectlyAnalysis()
];

export default analysisTasks;
