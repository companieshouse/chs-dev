import { simpleColouriser } from "../../../helpers/colouriser.js";

export default class TroubleshootOutputLogger {

    private readonly logger: (msg: string) => void;

    constructor (logger: (msg: string) => void) {
        this.logger = logger;
    }

    logMessage (message: string, stat: "Success" | "Error"): void {
        stat === "Success"
            ? this.logger(`${simpleColouriser("SUCCESS!", "bold-green")} ${message}`)
            : this.logger(`${simpleColouriser("FAILED!", "red")} ${message}`);

    }
}
