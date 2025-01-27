import NewServiceSpec from "../../../model/NewServiceSpec.js";
import BasePrompt from "./BasePrompt.js";
import { input } from "../../../helpers/user-input.js";

/**
 * A prompt that will ask the user to provide a text input.
 */
export default class TextPrompt extends BasePrompt<string> {
    constructor (
        public readonly text: string,
        readonly selector: string,
        readonly predicate?: (newServiceSpec: Partial<NewServiceSpec>) => boolean
    ) {
        super(selector, predicate);
    }

    getUserInput (_: Partial<NewServiceSpec>): Promise<string> {
        return input(this.text);
    }
}
