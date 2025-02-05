/**
 * checks if the CH_IBOSS_TRIAL variable is set and not any of the invalid values
 * `"false", "no", "0"`
 *
 * @returns boolean
 */
export const isIbossEnabled: () => boolean = () => {
    const env = process.env.CH_IBOSS_TRIAL?.toLowerCase();
    const invalidValues = new Set(["false", "no", "0"]);
    if (!env) return false;
    return !invalidValues.has(env);
};
