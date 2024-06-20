/**
 * Represents project configuration defining project related properties for
 * customising the behaviours of chs-dev
 */
export type Config = {

    /**
     * path to the project repository
     */
    readonly projectPath: string;

    /**
     * additional environment variables for running the environment. Values can
     * contain 'file://' prefixes will try to read file in and set as value in
     * its place.
     */
    readonly env: Record<string, string>;
}

export default Config;
