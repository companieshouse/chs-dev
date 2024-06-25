import Development from "./development.js";
import Down from "./down.js";
import Exclusions from "./exclusions.js";
import Logs from "./logs.js";
import Modules from "./modules.js";
import Reload from "./reload.js";
import Services from "./services.js";
import Status from "./status.js";
import Sync from "./sync.js";
import Up from "./up.js";

export const commands = {
    development: Development,
    down: Down,
    exclusions: Exclusions,
    modules: Modules,
    reload: Reload,
    services: Services,
    status: Status,
    up: Up,
    sync: Sync,
    logs: Logs
};

export default commands;
