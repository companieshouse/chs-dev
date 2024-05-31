export const collect = <U, T>(fn: (value: T) => U[]): (result: U[], value: T) => U[] => {
    return (values: U[], value: T): U[] => {
        values.push(...fn(value));
        return values;
    };
};

export const deduplicate = (uniqueValues: string[], value: string): string[] => {
    if (!uniqueValues.includes(value)) {
        uniqueValues.push(value);
    }
    return uniqueValues;
};
