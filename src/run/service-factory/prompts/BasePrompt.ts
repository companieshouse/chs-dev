import NewServiceSpec from "../../../model/NewServiceSpec.js";
import { applySelector, get } from "../utils.js";
import { confirm } from "../../../helpers/user-input.js";

/**
 * Abstract implementation of a prompt that will ask the user for input.
 * Implementations of this class should provide a way to get user input.
 */
export default abstract class BasePrompt<T> {

    private static readonly MAXIMUM_RETRIES_FOR_PROMPT = 5;

    // eslint-disable-next-line no-useless-constructor
    constructor (
        /**
         * The selector to apply the user input to in the newServiceSpec.
         * This is a dot separated string that will be used to apply the user input
         * to the newServiceSpec.
         */
        public readonly selector: string,

        /**
         * Predicate to determine if this prompt should be used for the given service spec.
         */
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

        // When the value is already set, ask the user if they want to change it, otherwise skip the prompt
        if (typeof initialValue !== "undefined") {
            if (!(await confirm(`${this.selector} is already set to "${initialValue}". Do you want to change it?`))) {
                return newServiceSpec;
            }
        }

        let promptAttempts = 1;

        while (promptAttempts <= BasePrompt.MAXIMUM_RETRIES_FOR_PROMPT) {
            if (typeof this.predicate !== "undefined" && !this.predicate(newServiceSpec)) {
                return newServiceSpec;
            }

            const userInput = await this.getUserInput(newServiceSpec);

            if (typeof userInput === "undefined" || userInput === "") {
                console.error("Please provide a response to the former question");

                promptAttempts++;

                continue;
            }

            return applySelector(newServiceSpec, this.selector, userInput);
        }

        if (promptAttempts > BasePrompt.MAXIMUM_RETRIES_FOR_PROMPT) {
            throw new Error(`Invalid response to question: failed after ${BasePrompt.MAXIMUM_RETRIES_FOR_PROMPT} attempts`);
        }
    }

    /**
     * Method to get the user input for the prompt.
     * @param newServiceSpec Being built up
     * @returns the value provided by the user
     */
    abstract getUserInput(newServiceSpec: Partial<NewServiceSpec>): Promise<T>;
}
