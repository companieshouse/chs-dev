import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";

import yaml from "yaml";
import glob from "glob";

import { createHash } from "crypto";
import { Service } from "../model/Service.js";
import { Module } from "../model/Module.js";
import { readServices } from "./service-reader.js";
import { DependencyNameResolver } from "./dependency-name-resolver.js";
import { DependencyTreeBuilder } from "./dependency-tree-builder.js";
import DependencyNode from "../model/DependencyNode.js";

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
            if (inventoryCache.hash === this.hashServiceCacheObject()) {
                return cacheSupplier(inventoryCache);
            }
        }
        this.updateCache();

        return this.getFromCache(cacheSupplier);
    }

    private updateCache () {
        const inventory = {
            hash: this.hashServiceCacheObject(),
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

    private get __servicesCacheObject (): Service[] {
        const partialServices: Partial<Service>[] = this.serviceFiles.flatMap(readServices);
        const dependencyNameResolver = new DependencyNameResolver(partialServices);

        const dependencyTreeBuilder = new DependencyTreeBuilder(partialServices);

        return partialServices.map(service => {
            const fullDependencyList = dependencyNameResolver.fullDependencyListIncludingTransitive(
                Array.isArray(service.dependsOn) ? service.dependsOn as string[] : []
            );

            return {
                ...service,
                dependencyTree: dependencyTreeBuilder.dependencyTree(service.name as string),
                dependsOn: fullDependencyList,
                numberOfDependencies: fullDependencyList.length
            } as Service;
        });
    }

    private loadServices (): Service[] {
        const services: Service[] = this.__servicesCacheObject;

        services.forEach(dependency => {
            let count = 0;
            services.forEach(service => {
                if (service.name !== dependency.name) {
                    count = count + this.addTimesReferenced(service.dependencyTree as DependencyNode, dependency.name);
                }
            });
            dependency.timesUsedByOtherServices = count;
        });

        return services;
    }

    private addTimesReferenced (dependencyTree: DependencyNode, dependencyName: String) {
        let count = 0;

        function traverse (node: DependencyNode) {
            if (node.name === dependencyName) {
                count++;
            }
            node.dependencies.forEach(childNode => traverse(childNode));
        }

        traverse(dependencyTree);

        return count;
    }

    private hashServiceCacheObject () {
        const sha256Hash = createHash("sha256");

        sha256Hash.update(JSON.stringify(this.__servicesCacheObject));

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
