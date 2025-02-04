/**
 * checks if the CH_IBOSS_TRIAL variable is set in the environment as a boolean value
 *
 * @returns boolean
 */
export const isIbossEnabled: () => boolean = () => {
    const env = process.env.CH_IBOSS_TRIAL?.toLowerCase();
    const invalidValues = new Set(["false", "no", "0"]);
    return !!(env && !invalidValues.has(env));
};
