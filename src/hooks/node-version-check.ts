import { Hook } from "@oclif/config";

import { minVersion, satisfies } from "semver";
import { engines } from "./../../package.json";

export const hook: Hook<"init"> = async function () {
    if (!satisfies(process.version, engines.node)) {
        this.error(`CLI requires Node.js ${minVersion(engines.node)} or newer`);
    }
};
