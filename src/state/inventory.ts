import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

import yaml from "yaml";
import glob from "glob";

import { createHash } from "crypto";
import { Service } from "../model/Service.js";
import { Module } from "../model/Module.js";
import { readServices } from "./service-reader.js";
import { DependencyNameResolver } from "./dependency-name-resolver.js";

interface InventoryCache {
  hash: string;
  services: Service[];
  modules: Module[]
}

export class Inventory {
    readonly inventoryCacheFile: string;
    private __serviceFiles: string[] | undefined;

    constructor (private path: string, cacheDir: string) {
        this.path = path;
        this.inventoryCacheFile = join(cacheDir, `${basename(path)}.inventory.yaml`);

        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, {
                recursive: true
            });
        }
    }

    get modules (): Module[] {
        return this.getFromCache(inventoryCache => inventoryCache.modules);
    }

    get services (): Service[] {
        return this.getFromCache(inventoryCache => inventoryCache.services);
    }

    private getFromCache<T> (cacheSupplier: (inventoryCache: InventoryCache) => T): T {
        const inventoryCache = this.inventoryCache;

        if (typeof inventoryCache !== "undefined") {
            if (inventoryCache.hash === this.hashServiceFiles()) {
                return cacheSupplier(inventoryCache);
            }
        }

        this.updateCache();

        return this.getFromCache(cacheSupplier);
    }

    private updateCache () {
        const inventory = {
            hash: this.hashServiceFiles(),
            services: this.loadServices(),
            modules: this.loadModules()
        };

        writeFileSync(this.inventoryCacheFile, yaml.stringify(inventory));
    }

    private loadModules (): Module[] {
        return readdirSync(join(this.path, "services", "modules"), { withFileTypes: true })
            .filter(item => item.isDirectory())
            .map(item => {
                return {
                    name: item.name
                };
            });
    }

    private loadServices (): Service[] {
        const partialServices: Partial<Service>[] = this.serviceFiles.flatMap(readServices);

        const dependencyNameResolver = new DependencyNameResolver(partialServices);

        return partialServices.map(service => ({
            ...service,
            dependsOn: dependencyNameResolver.fullDependencyListIncludingTransitive(service.dependsOn as string[])
        } as Service));
    }

    private hashServiceFiles () {
        const sha256Hash = createHash("sha256");

        this.serviceFiles
            .map(serviceFile => readFileSync(serviceFile))
            .forEach((serviceFile:any) => {
                sha256Hash.update(serviceFile);
            });

        return sha256Hash.digest("hex");
    }

    private get inventoryCache (): InventoryCache | undefined {
        if (existsSync(this.inventoryCacheFile)) {
            return yaml.parse(readFileSync(this.inventoryCacheFile).toString("utf-8"));
        }

        return undefined;
    }

    private get serviceFiles (): string[] {
        if (typeof this.__serviceFiles === "undefined") {
            this.__serviceFiles = glob.sync(`${this.path}/services/**/*.docker-compose.yaml`);
        }
        return this.__serviceFiles;
    }
}
