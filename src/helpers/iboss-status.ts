/**
 * checks if the CH_IBOSS_TRIAL variable is set in the environment as a boolean value
 *
 * @returns boolean
 */
export const isIbossEnabled: () => boolean = () => {
    const env = process.env.CH_IBOSS_TRIAL?.toLowerCase();
    return !!(env && env !== "false" && env !== "no" && env !== "0");
};
