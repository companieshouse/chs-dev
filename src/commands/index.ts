import Down from "./down.js";
import Exclusions from "./exclusions.js";
import Logs from "./logs.js";
import Modules from "./modules.js";
import Reload from "./reload.js";
import Status from "./status.js";
import Sync from "./sync.js";
import Up from "./up.js";
import DevelopmentServices from "./development/services.js";
import DevelopmentEnable from "./development/enable.js";
import DevelopmentDisable from "./development/disable.js";
import ServicesAvailable from "./services/available.js";
import ServiceEnable from "./services/enable.js";
import ServiceDisable from "./services/disable.js";

export const commands = {
    down: Down,
    exclusions: Exclusions,
    modules: Modules,
    reload: Reload,
    status: Status,
    up: Up,
    sync: Sync,
    logs: Logs,
    "development:services": DevelopmentServices,
    "development:enable": DevelopmentEnable,
    "development:disable": DevelopmentDisable,
    "services:available": ServicesAvailable,
    "services:enable": ServiceEnable,
    "services:disable": ServiceDisable
};

export default commands;
