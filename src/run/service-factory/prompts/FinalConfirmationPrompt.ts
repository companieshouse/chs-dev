import { confirm, editor } from "../../../helpers/user-input.js";
import NewServiceSpec from "../../../model/NewServiceSpec.js";
import yaml from "yaml";

/**
 * A prompt that will ask the user to confirm the final service specification.
 * Allowing the user to amend the service specification if they
 * are not happy with the generated service spec.
 */
export default class FinalConfirmationPrompt {

    selector: string = ".";

    async make (newServiceSpec: Partial<NewServiceSpec>): Promise<Partial<NewServiceSpec>> {
        let finalServiceSpec: Partial<NewServiceSpec> = newServiceSpec;

        while (true) {
            console.log("Generated service spec:");

            console.log(yaml.stringify(finalServiceSpec));

            if (await confirm("Are you happy with the above service specification?")) {
                break;
            }

            const amendedYaml = await editor(
                "Amend the service specification as desired", {
                    initialValue: yaml.stringify(newServiceSpec),
                    waitForUserInput: false
                }
            );

            finalServiceSpec = yaml.parse(amendedYaml);
        };

        return finalServiceSpec;
    }
}
