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

/**
 * Checks if there is at least one common element between two arrays.
 *
 * @param {unknown[]} array1 - The first array to compare.
 * @param {unknown[]} array2 - The second array to compare.
 * @returns {boolean} - Returns `true` if any element in `array1` exists in `array2`, otherwise `false`.
 */
export const matchExistInArrays = (array1: unknown[], array2: unknown[]): boolean => {
    return array1.some(item => array2.includes(item));
};

/**
 * Finds and returns elements from the parentArray that do not exist in the childArray.
 *
 * @param {unknown[]} parentArray - The source array to check.
 * @param {unknown[]} childArray - The reference array to compare against.
 * @returns {any[]} - An array containing elements from `parentArray` that are not present in `childArray`.
 */
export const findUniqueItemsInParentArray = (parentArray: unknown[], childArray: unknown[]): any[] => {
    const childSet = new Set(childArray);
    return parentArray.filter(item => !childSet.has(item));
};
