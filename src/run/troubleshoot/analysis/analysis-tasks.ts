import AnalysisTask from "./AnalysisTask.js";
import AwsEnvironmentVariableAnalysis from "./AwsEnvironmentVariableAnalysis.js";
import DockerChsDevelopmentVersionAnalysis from "./DockerChsDevelopmentVersionAnalysis.js";
import DockerMemoryAnalysis from "./DockerMemoryAnalysis.js";
import EcrLoginAnalysis from "./ECRLoginAnalysis.js";
import PortAnalysis from "./PortAnalysis.js";
import ProxiesConfiguredCorrectlyAnalysis from "./ProxiesConfiguredCorrectlyAnalysis.js";
import ServicesInLiveUpdateConfiguredCorrectlyAnalysis from "./ServicesInLiveUpdateConfiguredCorrectlyAnalysis.js";
import VersionAnalysis from "./VersionAnalysis.js";

const analysisTasks: AnalysisTask[] = [
    new ServicesInLiveUpdateConfiguredCorrectlyAnalysis(),
    new ProxiesConfiguredCorrectlyAnalysis(),
    new DockerMemoryAnalysis(),
    new EcrLoginAnalysis(),
    new VersionAnalysis(),
    new PortAnalysis(),
    new DockerChsDevelopmentVersionAnalysis(),
    new AwsEnvironmentVariableAnalysis()
];

export default analysisTasks;
