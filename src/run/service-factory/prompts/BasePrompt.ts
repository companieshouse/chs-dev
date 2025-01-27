import NewServiceSpec from "../../../model/NewServiceSpec.js";
import { applySelector, get } from "../utils.js";
import { confirm } from "../../../helpers/user-input.js";

/**
 * Abstract implementation of a prompt that will ask the user for input.
 * Implementations of this class should provide a way to get user input.
 */
export default abstract class BasePrompt<T> {

    // eslint-disable-next-line no-useless-constructor
    constructor (
        public readonly selector: string,
        public readonly predicate?: (newServiceSpec: Partial<NewServiceSpec>) => boolean
    ) {}

    /**
     * Get the user input and apply it to the newServiceSpec ensuring that the
     * user has provided a response to the prompt.
     * @param newServiceSpec being constructed
     * @returns amended newServiceSpec with the user input
     */
    async make (newServiceSpec: Partial<NewServiceSpec>) {
        const initialValue = get(newServiceSpec, this.selector);

        if (typeof initialValue !== "undefined") {
            if (!(await confirm(`${this.selector} is already set to "${initialValue}". Do you want to change it?`))) {
                return newServiceSpec;
            }
        }

        while (true) {
            if (typeof this.predicate !== "undefined" && !this.predicate(newServiceSpec)) {
                return newServiceSpec;
            }

            const userInput = await this.getUserInput(newServiceSpec);

            if (typeof userInput === "undefined" || userInput === "") {
                console.error("Please provide a response to the former question");
                continue;
            }

            return applySelector(newServiceSpec, this.selector, userInput);
        }
    }

    abstract getUserInput(newServiceSpec: Partial<NewServiceSpec>): Promise<T>;
}
