import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";

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

export const writeContentToFile = (data: Record<string, any>, fullPath: string): void => {
    const lines = [
        "# DO NOT MODIFY MANUALLY",
        yaml.stringify(data)
    ];
    writeFileSync(fullPath, lines.join("\n\n"));
};

export const readFileContent = (filePath: string): Record<string, any> => {
    if (existsSync(filePath)) {
        const fileContent = yaml.parse(
            readFileSync(filePath, "utf-8")
        );
        return fileContent || {};
    }
    return {};
};
