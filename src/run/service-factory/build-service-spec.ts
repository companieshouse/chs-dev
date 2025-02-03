import NewServiceSpec from "../../model/NewServiceSpec.js";
import { Prompt } from "./prompts/index.js";

/**
 * Factory of a function which will prompt the user for input to build up a
 * NewServiceSpec object. When supplied with a value for this will use this as
 * the initial input value for the field
 * @param prompts containing the prompts to user and/or prompts to set
 *      the values on the NewServiceSpec being constructed
 * @returns Callable which will produce the NewServiceSpec completed with the
 * values supplied by the user
 */
const buildServiceSpecFromUserInput = (prompts: Prompt[]) => async (newServiceSpec?: Partial<NewServiceSpec>) => {
    let newServiceSpecUnderConstruction = newServiceSpec || {};

    for (const prompt of prompts) {
        const predicate = prompt.predicate;

        if (typeof predicate === "undefined" || predicate(newServiceSpecUnderConstruction)) {
            newServiceSpecUnderConstruction = await prompt.make(newServiceSpecUnderConstruction);
        }
    }

    return newServiceSpecUnderConstruction;
};

export default buildServiceSpecFromUserInput;
