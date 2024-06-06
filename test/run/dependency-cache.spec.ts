import { jest, expect } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";

describe("DependencyCache", () => {
    const execSyncMock = jest.spyOn(childProcess, "execSync");
    const existsSyncMock = jest.spyOn(fs, "existsSync");
    const mkdirSyncMock = jest.spyOn(fs, "mkdirSync");

    let DependencyCache;

    beforeEach(async () => {
        jest.resetAllMocks();
        ({ DependencyCache } = await import("../../src/run/dependency-cache"));
    });

    it("creates local m2 cache when not in existence", () => {
        mkdirSyncMock.mockImplementation(() => {});
        existsSyncMock.mockReturnValue(false);

        // Testing the side effects from constructor call
        // eslint-disable-next-line no-new
        new DependencyCache("/home/user/project");

        expect(mkdirSyncMock).toHaveBeenCalledWith("/home/user/project/local/.m2", { recursive: true });
    });

    it("does not create local m2 cache when exists already", () => {
        existsSyncMock.mockReturnValue(true);

        // Testing the side effects from constructor call
        // eslint-disable-next-line no-new
        new DependencyCache("/home/user/project");

        expect(mkdirSyncMock).not.toHaveBeenCalled();
    });

    it("runs rsync when update called", () => {
        // @ts-expect-error
        execSyncMock.mockImplementation((command, options) => {});
        existsSyncMock.mockReturnValue(true);

        const cache = new DependencyCache("/home/user/project");

        cache.update();

        expect(execSyncMock).toHaveBeenCalledWith(
            `rsync -au "\${HOME}"/.m2/repository/uk/ "/home/user/project"/local/.m2/uk/`
        );
    });

});
