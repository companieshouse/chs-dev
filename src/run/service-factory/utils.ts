import NewServiceSpec from "../../model/NewServiceSpec.js";

/**
 * Apply the value to the newServiceSpec at the selector. The selector can
 * reference a nested object using dot notation. For example, ".configuration.docker-chs-development.module"
 * but not using array notation (i.e. .configuration["docker-chs-development"]["module"]).
 * @param selector Jq like selector to apply the value to
 * @param newServiceSpec The newServiceSpec to apply the value to
 * @param newValue The value to apply
 * @returns The newServiceSpec with the value applied
 */
export const applySelector = (newServiceSpec: Partial<NewServiceSpec>, selector: string, newValue: any) => {
    const nestedKeys = extractValidNestedKeys(selector);

    if (nestedKeys.length > 1) {
        const newServiceSpecSubAttribute = getNextLevelObject(newServiceSpec, nestedKeys[0]);

        return {
            ...newServiceSpec,
            [nestedKeys[0]]: applySelector(
                newServiceSpecSubAttribute,
                `.${nestedKeys.slice(1).join(".")}`,
                newValue
            )
        };
    } else {
        return {
            ...newServiceSpec,
            [nestedKeys[0]]: newValue
        };
    }
};

/**
 * Lookup a value in the newServiceSpec at the selector. The selector can
 * reference a nested object using dot notation. For example, ".configuration.docker-chs-development.module"
 * but not using array notation (i.e. .configuration["docker-chs-development"]["module"]).
 * @param newServiceSpec NewServiceSpec to lookup the value in
 * @param selector Jq like selector to lookup the value at
 * @returns The value at the selector
 */
export const get = (newServiceSpec: Partial<NewServiceSpec>, selector: string) => {
    const nestedKeys = extractValidNestedKeys(selector);

    if (nestedKeys.length > 1) {
        const newServiceSpecSubAttribute = getNextLevelObject(newServiceSpec, nestedKeys[0]);

        return get(newServiceSpecSubAttribute, `.${nestedKeys.slice(1).join(".")}`);
    } else {
        return newServiceSpec[nestedKeys[0]];
    }
};

const isSelectorValid = (selector: string) => {
    return /^\.([A-Za-z0-9_-]+\.?)+$/.test(selector);
};

const extractValidNestedKeys = (selector: string) => {
    if (!isSelectorValid(selector)) {
        throw new Error("Invalid selector");
    }

    return selector.split(".").slice(1);
};

const getNextLevelObject = (newServiceSpec: Partial<NewServiceSpec>, nestedKey: string) => {
    return newServiceSpec[nestedKey] || {};
};
