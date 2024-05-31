import { writeFileSync } from "fs";
import { EOL } from "os";
import { join } from "path";

export abstract class AbstractFileGenerator {
    // Used by subclasses to set the values
    // eslint-disable-next-line no-useless-constructor
    protected constructor (protected path: string, protected fileName: string) {}

    protected writeFile (lines: string[], joinChar: string = EOL + EOL, fileName = this.fileName) {
        writeFileSync(join(this.path, fileName), ["# DO NOT MODIFY THIS FILE MANUALLY", ...lines].join(joinChar));
    }
}
