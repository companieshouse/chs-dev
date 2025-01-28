import * as inquirer from "@inquirer/prompts";

/**
 * Type defining the options for the confirm function
 */
type ConfirmOptions = {
    /**
     * Value to use when the user does not supply a value
     */
    defaultValue?: boolean
}

/**
 * Provides a type of an object which customises choices for an input beyond
 * the value
 */
type Choice = {
    /**
     * When choice is selected sets the value of the choice selected
     */
    value: string;

    /**
     * Sets the value of the option presented to the user
     */
    name?: string;

    /**
     * Meaningful description for the option
     */
    description?: string;
    short?: string;

    /**
     * Whether or not the option is able to be selected or not
     */
    disabled?: boolean | string
}

/**
 * Provides a type for the options supplied to the input function
 */
type InputOptions = {
    /**
     * List of choices for the options, when not supplied it will prompt the
     * user for free text rather than from a list
     */
    options?: string[] | Choice[];

    /**
     * Default value for the input when user has not been supplied
     */
    defaultValue?: string
}

/**
 * Provides a type for the options passed to the editor function
 */
type EditorOptions = {
    /**
     * The initial value for the editor shown to the user
     */
    initialValue?: string,

    /**
     * Whether the user needs to accept opening of the editor or not
     */
    waitForUserInput?: boolean
}

const defaultValue = (opts: any | undefined) => ({
    ...(typeof opts !== "undefined" && typeof opts.defaultValue !== "undefined" ? { default: opts.defaultValue } : {})
});

/**
 * Prompts the user for a confirmation to a question
 * @param question human readable prompt for the user to supply that is the
 *  basis for the confirmation
 * @param options configuration for the confirmation
 * @returns Promise containing boolean output of the user confirmation
 */
export const confirm = (
    question: string,
    options?: ConfirmOptions
) => {
    return inquirer.confirm({
        message: question,
        ...defaultValue(options)
    });
};

/**
 * Prompts the user for a value in response to a question. When options have
 * been supplied offers the user a list to choose from otherwise just accepts
 * plain text input.
 * @param question human readable prompt for the user to supply that is the
 *  basis for the input
 * @param options configuration for the confirmation
 * @returns value entered by the user either selected from options or from
 * what they have typed
 */
export const input: (q: string, o?: InputOptions) => Promise<string> = (
    question: string,
    options?: InputOptions
) => {

    if (typeof options?.options === "undefined") {
        return inquirer.input({
            message: question,
            ...defaultValue(options)
        });
    } else {
        return inquirer.select({
            message: question,
            choices: options.options.some(option => typeof option === "string")
                ? options.options.map(optionValue => ({ value: optionValue }))
                : options.options as Choice[],
            ...defaultValue(options)
        });
    }
};

/**
 * Prompts the user for input opening an editor for them to enter the data
 * within
 * @param question human readable prompt for the user to supply that is the
 *  basis for the input
 * @param options configuration for the confirmation
 * @returns output of the editor when it has been closed by the user
 */
export const editor: (
    q: string,
    o?: EditorOptions
) => Promise<string> = (
    question: string,
    options?: EditorOptions
): Promise<string> => {
    return inquirer.editor({
        message: question,
        ...defaultValue({ defaultValue: options?.initialValue }),
        ...(typeof options?.waitForUserInput !== "undefined"
            ? {
                waitForUserInput: options.waitForUserInput
            }
            : {})
    });
};
