import { dirname, join, relative } from "path";

/**
 * Creates relative paths from the destination directory to the source for the
 * supplied paths supplied.
 * @param paths Array of strings or string representing the paths being
 *      converted to relative paths
 * @param source original location from which the path was relative to prior
 * @param destinationDirectory Location from which the new path will be
 *      relative from
 * @returns relative path from the destination directory to the paths provided
 */
export const relativiseServicePath = (
    paths: string | string[],
    source: string,
    destinationDirectory: string
) => {
    if (Array.isArray(paths)) {
        return paths.map(
            singleValue => relativiseServicePath(singleValue, source, destinationDirectory)
        );
    }

    const relativePathToSource = relative(destinationDirectory, source);

    return join(dirname(relativePathToSource), paths);
};

export default relativiseServicePath;
