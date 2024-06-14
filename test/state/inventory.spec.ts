import { expect, jest } from "@jest/globals";
import { copySync } from "fs-extra";
import { join } from "path";
import fs from "fs";
import { Inventory, Service } from "../../src/state/inventory";
import { parse, stringify } from "yaml";

describe("Inventory", () => {
    let tempDir: string;
    let inventoryDir: string;
    let confDir: string;
    let inventoryConfFile: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync("inventory");
        inventoryDir = join(tempDir, "inventory");
        confDir = join(tempDir, "conf");
        inventoryConfFile = join(confDir, "inventory.yaml");

        copySync(
            join(
                process.cwd(), "test/data/inventory"
            ),
            inventoryDir
        );
    });

    afterEach(() => {
        // @ts-expect-error does exist
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const addNewService = (moduleName: string, serviceName: string) => {
        const newModulePath = join(inventoryDir, "services/modules", moduleName);

        fs.mkdirSync(newModulePath);

        const newService = {
            services: {
                [serviceName]: {
                    labels: [
                        "- chs.repository.url=git@github.com:companieshouse/service-five.git"
                    ],
                    depends_on: {
                        mongo: {
                            condition: "service_healthy"
                        }
                    }
                }
            }
        };

        fs.writeFileSync(
            join(newModulePath, `${serviceName}.docker-compose.yaml`),
            stringify(newService)
        );
    };

    describe("constructor", () => {
        afterEach(() => {
            // @ts-expect-error
            fs.rmSync(confDir, { recursive: true, force: true });
        });

        it("creates conf directory if not in existence", () => {
            // eslint-disable-next-line no-new
            new Inventory(inventoryDir, confDir);

            expect(fs.existsSync(confDir)).toBe(true);
        });

        it("does not create conf directory if in existence", () => {
            fs.mkdirSync(confDir);

            const mkdirSyncMock = jest.spyOn(fs, "mkdirSync");

            // eslint-disable-next-line no-new
            new Inventory(inventoryDir, confDir);

            expect(mkdirSyncMock).not.toHaveBeenCalled();
        });

        it("reads from inventory cache correctly", () => {

            const inventory = new Inventory(inventoryDir, confDir);

            expect(inventory.inventoryCacheFile).toEqual(inventoryConfFile);
        });
    });

    describe("modules", () => {
        let inventory: Inventory;

        beforeEach(() => {
            inventory = new Inventory(inventoryDir, confDir);

            if (fs.existsSync(inventoryConfFile)) {
                fs.unlinkSync(inventoryConfFile);
            }
        });

        it("shows modules", () => {
            expect(inventory.modules).toEqual([
                { name: "module-one" },
                { name: "module-two" }
            ]);
        });

        it("when no changes always shows the correct modules", () => {
            const modulesCallOne = inventory.modules;
            const modulesCallTwo = inventory.modules;

            expect(modulesCallOne).toEqual(modulesCallTwo);
        });

        it("invalidates cache when new module added", () => {
            const modulesCallOne = inventory.modules;

            const newModule = "module-three";
            addNewService(newModule, "service-five");

            inventory = new Inventory(inventoryDir, confDir);
            const modulesCallTwo = inventory.modules;

            expect(modulesCallOne).not.toEqual(modulesCallTwo);
            expect(modulesCallTwo).toContainEqual({ name: newModule });
        });
    });

    describe("services", () => {
        let inventory: Inventory;

        beforeEach(() => {
            inventory = new Inventory(inventoryDir, confDir);

            if (fs.existsSync(inventoryConfFile)) {
                fs.unlinkSync(inventoryConfFile);
            }
        });

        it("returns services with all dependencies", () => {

            const actual = inventory.services;

            for (const service of actual) {
                service.source = service.source.replace(inventoryDir, "inventory");
            }

            expect(actual).toMatchSnapshot();

        });

        it("invalidates cache when a new service is added", () => {

            const initialState = inventory.services;

            const newModule = "module-three";
            addNewService(newModule, "service-eight");

            inventory = new Inventory(inventoryDir, confDir);
            const amendedState = inventory.services;

            expect(amendedState).not.toEqual(initialState);
            const serviceEightExists = amendedState.some(service => service.name === "service-eight");
            expect(serviceEightExists).toBe(true);

        });

        it("invalidates cache when a service is modified", () => {
            const initialState = inventory.services;

            const initialService = initialState.find(service => service.name === "service-one");

            expect(initialService?.metadata.languageMajorVersion).toEqual(null);

            const servicePath = join(inventoryDir, "services/modules/module-one/service-one.docker-compose.yaml");

            const service = parse(fs.readFileSync(servicePath).toString("utf8"));

            service.services["service-one"].labels = [
                ...service.services["service-one"].labels,
                "chs.local.builder.languageVersion=17"
            ];

            fs.writeFileSync(
                servicePath,
                stringify(service)
            );

            const amendedState = inventory.services;

            expect(amendedState).not.toEqual(initialState);

            const amendedService = amendedState.find(service => service.name === "service-one");

            expect(amendedService?.metadata.languageMajorVersion).toEqual("17");
        });

        it("invalidates cache when service is removed", () => {
            const initialState = inventory.services;

            expect(initialState.find(service => service.name === "service-three")).toBeTruthy();

            const servicePath = join(inventoryDir, "services/modules/module-two/service-three.docker-compose.yaml");

            // @ts-expect-error does exist
            fs.rmSync(servicePath);

            inventory = new Inventory(inventoryDir, confDir);
            const amendedState = inventory.services;

            expect(amendedState).not.toEqual(initialState);

            expect(amendedState.find(service => service.name === "service-three")).toBeFalsy();
        });
    });
});
