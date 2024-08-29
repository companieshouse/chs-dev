import * as inquirer from "@inquirer/prompts";

type ConfirmOptions = {
    defaultValue?: boolean
}

type Choice = {
    value: string;
    name?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string
}

type InputOptions = {
    options?: string[] | Choice[],
    defaultValue?: string
}

type EditorOptions = {
    initialValue?: string,
    waitForUserInput?: boolean
}

const defaultValue = (opts: any | undefined) => ({
    ...(typeof opts !== "undefined" && typeof opts.defaultValue !== "undefined" ? { default: opts.defaultValue } : {})
});

export const confirm = (
    question: string,
    options?: ConfirmOptions
) => {
    return inquirer.confirm({
        message: question,
        ...defaultValue(options)
    });
};

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
