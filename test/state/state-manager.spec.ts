import { afterAll, beforeAll, expect } from "@jest/globals";
// @ts-expect-error does exist
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { StateManager } from "../../src/state/state-manager";
import { join } from "path";
import { parse } from "yaml";

describe("StateManager", () => {
    let tempDir;
    let stateManager: StateManager;
    let chsDevFile;

    beforeAll(() => {
        tempDir = mkdtempSync("statemanager");
        chsDevFile = join(tempDir, ".chs-dev.yaml");
    });

    beforeEach(() => {
        stateManager = new StateManager(tempDir);
    });

    afterEach(() => {
        if (existsSync(chsDevFile)) {
            unlinkSync(chsDevFile);
        }
    });

    afterAll(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    const setStateFile = (stateFileName) => {
        copyFileSync(
            join(
                process.cwd(), `test/data/state-manager/chs-dev.yaml/${stateFileName}`
            ),
            join(tempDir, ".chs-dev.yaml")
        );
    };

    const readSnapshotFile = () => parse(readFileSync(chsDevFile).toString("utf8"));

    it("returns empty state for snapshot when file does not exist", () => {
        const state = stateManager.snapshot;

        expect(state).toEqual({
            modules: [],
            services: [],
            servicesWithLiveUpdate: [],
            excludedServices: []
        });
    });

    it("after including service snapshot includes service", () => {
        stateManager.includeService("service-one");

        const state = stateManager.snapshot;

        expect(state.services).toContain("service-one");
    });

    it("after including service file includes service", () => {
        stateManager.includeService("service-one");

        const snapshotInFile = readSnapshotFile();

        expect(snapshotInFile.services).toContain("service-one");
    });

    it("when service exists and is removed then no longer in state", () => {
        setStateFile("one-enabled-in-each.yaml");

        expect(stateManager.snapshot.services).toContain("service-one");

        stateManager.excludeService("service-one");

        expect(stateManager.snapshot.services).not.toContain("service-one");
    });

    it("adds module", () => {
        stateManager.includeModule("module-one");

        const state = stateManager.snapshot;

        expect(state.modules).toContain("module-one");

        const snapshotFile = readSnapshotFile();

        expect(snapshotFile.modules).toContain("module-one");
    });

    it("removes module", () => {
        setStateFile("one-enabled-in-each.yaml");

        expect(stateManager.snapshot.modules).toContain("module-one");

        stateManager.excludeModule("module-one");

        expect(stateManager.snapshot.modules).not.toContain("module-one");
    });

    it("includes file", () => {
        stateManager.addExclusionForService("service-one");

        expect(stateManager.snapshot.excludedServices).toContain("service-one");

        expect(readSnapshotFile().excludedServices).toContain("service-one");
    });

    it("excludes file", () => {
        setStateFile("one-enabled-in-each.yaml");

        expect(stateManager.snapshot.excludedServices).toContain("service-one");

        stateManager.removeExclusionForService("service-one");

        expect(stateManager.snapshot.excludedServices).not.toContain("service-one");
    });

    it("adds to live update", () => {
        stateManager.includeServiceInLiveUpdate("service-one");

        expect(stateManager.snapshot.servicesWithLiveUpdate).toContain("service-one");
        expect(readSnapshotFile().servicesWithLiveUpdate).toContain("service-one");
    });

    it("removes from live update", () => {
        setStateFile("one-enabled-in-each.yaml");

        stateManager.excludeServiceFromLiveUpdate("service-one");

        expect(stateManager.snapshot.servicesWithLiveUpdate).not.toContain("service-one");
        expect(readSnapshotFile().servicesWithLiveUpdate).not.toContain("service-one");
    });

    describe("modifying state", () => {
        beforeEach(() => {
            setStateFile("state-with-somethings-enabled.yaml");
        });

        it("can add new services", () => {
            stateManager.includeService("service-two");

            expect(stateManager.snapshot.services).toContain("service-two");
        });

        it("can remove service", () => {
            stateManager.excludeService("service-one");

            expect(stateManager.snapshot.services).not.toContain("service-one");
        });
        it("can add new modules", () => {
            stateManager.includeModule("module-two");

            expect(stateManager.snapshot.modules).toContain("module-two");
        });

        it("can remove module", () => {
            stateManager.excludeModule("module-one");

            expect(stateManager.snapshot.modules).not.toContain("module-one");
        });
    });

    it("handles old statefile without excluded files entry when including file", () => {
        setStateFile("no-excluded-files-entry.yaml");

        stateManager.addExclusionForService("service-one");

        expect(stateManager.snapshot.excludedServices).toContain("service-one");
    });

    it("handles old statefile without excluded files entry when excluding file", () => {
        setStateFile("no-excluded-files-entry.yaml");

        stateManager.removeExclusionForService("service-one");

        expect(stateManager.snapshot.excludedServices.length).toBe(0);
    });
});
