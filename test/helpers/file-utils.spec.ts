import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getAllFilesInDirectory, isFile } from "../../src/helpers/file-utils";

jest.mock("fs");

const MOCK_DIR = "./testDir";
const MOCK_FILE = "docker-compose.yml";
const MOCK_FILE_CONTENT = `
version: "3.8"
services:
  app:
    image: "node:14"
`;

describe("file-utils", () => {

    beforeAll(() => {
        // Setup a mock directory and files
        mkdirSync(MOCK_DIR, { recursive: true });
        writeFileSync(join(MOCK_DIR, MOCK_FILE), MOCK_FILE_CONTENT);
        writeFileSync(join(MOCK_DIR, "example.txt"), "Hello, World!");
    });

    afterAll(() => {
        // Clean up mock directory and files
        rmSync(MOCK_DIR, { recursive: true, force: true });
    });

    describe("isFile", () => {
        it("should return true for a valid file", () => {
            const filePath = join(MOCK_DIR, MOCK_FILE);
            (lstatSync as jest.Mock).mockReturnValue({
                isFile: () => true
            });
            expect(isFile(filePath)).toBe(true);
        });

        it("should return false for a directory", () => {
            (lstatSync as jest.Mock).mockReturnValue({
                isFile: () => false
            });
            expect(isFile(MOCK_DIR)).toBe(false);
        });
    });

    describe("getAllFilesInDirectory", () => {
        it("should return all files in the directory", () => {
            (readdirSync as jest.Mock).mockReturnValue([MOCK_FILE]);
            (lstatSync as jest.Mock).mockReturnValue({
                isFile: () => true
            });
            const result = getAllFilesInDirectory(MOCK_DIR);
            expect(result).toEqual([
                join(MOCK_DIR, MOCK_FILE)
            ]);
        });

        it("should return an empty array for an empty directory", () => {
            const emptyDir = "./emptyTestDir";
            mkdirSync(emptyDir, { recursive: true });

            try {
                (readdirSync as jest.Mock).mockReturnValue([]);
                (lstatSync as jest.Mock).mockReturnValue({
                    isFile: () => false
                });
                const result = getAllFilesInDirectory(emptyDir);
                expect(result).toEqual([]);
            } finally {
                rmSync(emptyDir, { recursive: true, force: true });
            }
        });
    });
});
