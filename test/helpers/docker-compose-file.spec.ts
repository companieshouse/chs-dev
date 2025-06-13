import { afterAll, beforeAll, expect, jest } from "@jest/globals";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getInitialDockerComposeFile, getGeneratedDockerComposeFile } from "../../src/helpers/docker-compose-file"; // A

jest.mock("fs");

const MOCK_DIR = "./testDir";
const MOCK_FILE = "docker-compose.yml";
const MOCK_FILE_CONTENT = `
version: "3.8"
services:
  app:
    image: "node:14"
`;

describe("docker-compose-file", () => {

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

    describe("get Initial or Generated DockerComposeFile", () => {
        it("should parse Initial Docker Compose YAML file correctly", () => {
            (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_FILE_CONTENT));
            const result = getInitialDockerComposeFile(MOCK_DIR);
            expect(result).toEqual(MOCK_FILE_CONTENT);
        });

        it("should parse Generated Docker Compose YAML file correctly", () => {
            (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_FILE_CONTENT));
            const result = getGeneratedDockerComposeFile(MOCK_DIR);
            expect(result).toEqual(MOCK_FILE_CONTENT);
        });
    });
});
