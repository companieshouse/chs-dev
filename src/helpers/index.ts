/**
 * Checks if a given value is an object and not an array.
 *
 * @param {unknown} T - The value to check.
 * @returns {boolean} - Returns `true` if the value is an object and not an array, otherwise `false`.
 */
export const isObjectFormat = (T: unknown): boolean => {
    return typeof T === "object" && !Array.isArray(T) && T !== null;
};

/**
 * Determines if an object is empty.
 *
 * @param {Record<string, any>} obj - The object to check.
 * @returns {boolean} - Returns `true` if the object has no own enumerable properties, otherwise `false`.
 */
export const isEmptyObject = (obj: Record<string, any>): boolean => {
    return Object.keys(obj).length === 0;
};
