import Down from "./down.js";
import Logs from "./logs.js";
import Reload from "./reload.js";
import Status from "./status.js";
import Sync from "./sync.js";
import Up from "./up.js";
import ExclusionsList from "./exclusions/list.js";
import ExclusionsAdd from "./exclusions/add.js";
import ExclusionsRemove from "./exclusions/remove.js";
import DevelopmentServices from "./development/services.js";
import DevelopmentEnable from "./development/enable.js";
import InformationService from "./information/generateServiceDependencies.js"
import InformationSystem from "./information/generateSystemDependencies.js"
import DevelopmentDisable from "./development/disable.js";
import RepositoriesReport from "./information/repositories/generateReport.js";
import ServicesAvailable from "./services/available.js";
import ServiceEnable from "./services/enable.js";
import ServiceDisable from "./services/disable.js";
import ModulesAvailable from "./modules/available.js";
import ModulesEnable from "./modules/enable.js";
import ModulesDisable from "./modules/disable.js";
import ServiceLogs from "./deprecated/service-logs.js";
import TroubleshootAnalysis from "./troubleshoot/analyse.js";
import TroubleshootReport from "./troubleshoot/report.js";

export const commands = {
    down: Down,
    reload: Reload,
    status: Status,
    up: Up,
    sync: Sync,
    logs: Logs,
    "exclusions:list": ExclusionsList,
    "exclusions:add": ExclusionsAdd,
    "exclusions:remove": ExclusionsRemove,
    "development:services": DevelopmentServices,
    "development:enable": DevelopmentEnable,
    "development:disable": DevelopmentDisable,
    "services:available": ServicesAvailable,
    "services:enable": ServiceEnable,
    "services:disable": ServiceDisable,
    "information:service": InformationService,
    "information:system": InformationSystem,
    "information:repositories:report": RepositoriesReport,
    "modules:available": ModulesAvailable,
    "modules:enable": ModulesEnable,
    "modules:disable": ModulesDisable,
    "service-logs": ServiceLogs,
    "troubleshoot:analyse": TroubleshootAnalysis,
    "troubleshoot:report": TroubleshootReport
};

export default commands;
