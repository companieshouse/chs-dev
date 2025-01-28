import NewServiceSpec from "../../../model/NewServiceSpec.js";
import { confirm } from "../../../helpers/user-input.js";
import BasePrompt from "./BasePrompt.js";

/**
 * A prompt that will ask the user to confirm an action. If the user confirms
 * the action the value at the selector will be set to true.
 */
export default class ConfirmPrompt extends BasePrompt<boolean> {
    constructor (
        public readonly confirm: string,
        public readonly selector: string,
        public readonly predicate?: (newServiceSpec: Partial<NewServiceSpec>) => boolean
    ) {
        super(selector, predicate);
    }

    getUserInput (newServiceSpec: Partial<NewServiceSpec>): Promise<boolean> {
        return confirm(this.confirm);
    }
}
