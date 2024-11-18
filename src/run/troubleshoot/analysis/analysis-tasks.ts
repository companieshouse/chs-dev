import AnalysisTask from "./AnalysisTask.js";
import ServicesInLiveUpdateConfiguredCorrectlyAnalysis from "./ServicesInLiveUpdateConfiguredCorrectlyAnalysis.js";

const analysisTasks: AnalysisTask[] = [
    new ServicesInLiveUpdateConfiguredCorrectlyAnalysis()
];

export default analysisTasks;
