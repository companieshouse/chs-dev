import Down from "./down.js";
import Exclusions from "./exclusions.js";
import Logs from "./logs.js";
import Modules from "./modules.js";
import Reload from "./reload.js";
import Services from "./services.js";
import Status from "./status.js";
import Sync from "./sync.js";
import Up from "./up.js";
import DevelopmentServices from "./development/services.js";
import DevelopmentEnable from "./development/enable.js";
import DevelopmentDisable from "./development/disable.js";

export const commands = {
    down: Down,
    exclusions: Exclusions,
    modules: Modules,
    reload: Reload,
    services: Services,
    status: Status,
    up: Up,
    sync: Sync,
    logs: Logs,
    "development:services": DevelopmentServices,
    "development:enable": DevelopmentEnable,
    "development:disable": DevelopmentDisable
};

export default commands;
