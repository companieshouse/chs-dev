import { lstatSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Checks if a given path corresponds to a file.
 *
 * @param {string} fileName - The path to check.
 * @returns {boolean} - Returns `true` if the path is a file, otherwise `false`.
 */
export const isFile: (fileName: string) => boolean = fileName => {
    return lstatSync(fileName).isFile();
};

/**
 * Retrieves all files from a given directory.
 *
 * @param {string} dirPath - The directory path to scan.
 * @returns {string[]} - An array of file paths within the directory.
 */
export const getAllFilesInDirectory = (dirPath: string): string[] => {
    return readdirSync(dirPath).map(fileName => {
        return join(dirPath, fileName);
    }).filter(isFile);

};
