import { input } from "../../../helpers/user-input.js";
import NewServiceSpec from "../../../model/NewServiceSpec.js";
import BasePrompt from "./BasePrompt.js";

type SelectOption = {
    value: string,
    text?: string
}

/**
 * A prompt that will ask the user to select an option from a list of options.
 */
export default class SelectPrompt extends BasePrompt<string> {
    constructor (
        public readonly select: string,
        public readonly selector: string,
        public readonly options: SelectOption[] | ((config: Record<string, any>) => SelectOption[]),
        public readonly predicate?: (newServiceSpec: Partial<NewServiceSpec>) => boolean
    ) {
        super(selector, predicate);
    }

    getUserInput (newServiceSpec: Partial<NewServiceSpec>): Promise<string> {
        const selectOptions = typeof this.options === "function" ? this.options(newServiceSpec) : this.options;

        return input(this.select, {
            options: selectOptions.map(option => ({
                value: option.value,
                name: option.text
            }))
        });
    }
}
