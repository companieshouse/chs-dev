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
import DependencyService from "./dependency/service.js";
import DependencySystem from "./dependency/system.js";
import StateClean from "./state/clean.js";
import StateCache from "./state/cache.js";
import StateExport from "./state/export.js";
import StateRestore from "./state/restore.js";
import DevelopmentDisable from "./development/disable.js";
import ServicesAvailable from "./services/available.js";
import ServiceEnable from "./services/enable.js";
import ServiceDisable from "./services/disable.js";
import ModulesAvailable from "./modules/available.js";
import ModulesEnable from "./modules/enable.js";
import ModulesDisable from "./modules/disable.js";
import ComposeLogs from "./deprecated/compose-logs.js";
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
    "state:clean": StateClean,
    "state:cache": StateCache,
    "state:export": StateExport,
    "state:restore": StateRestore,
    "compose-logs": ComposeLogs,
    "exclusions:list": ExclusionsList,
    "exclusions:add": ExclusionsAdd,
    "exclusions:remove": ExclusionsRemove,
    "development:services": DevelopmentServices,
    "development:enable": DevelopmentEnable,
    "development:disable": DevelopmentDisable,
    "services:available": ServicesAvailable,
    "services:enable": ServiceEnable,
    "services:disable": ServiceDisable,
    "dependency:service": DependencyService,
    "dependency:system": DependencySystem,
    "modules:available": ModulesAvailable,
    "modules:enable": ModulesEnable,
    "modules:disable": ModulesDisable,
    "service-logs": ServiceLogs,
    "troubleshoot:analyse": TroubleshootAnalysis,
    "troubleshoot:report": TroubleshootReport
};

export default commands;
