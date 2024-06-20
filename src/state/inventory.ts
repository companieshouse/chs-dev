import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

import yaml from "yaml";
import glob from "glob";

import { collect, deduplicate } from "../helpers/array-reducers.js";
import { createHash } from "crypto";
import { Service } from "../model/Service.js";
import { Module } from "../model/Module.js";

interface DependencySpecification {
    condition: "service_started" | "service_healthy" | "service_complete";
    restart?: boolean;
    required?: boolean;
}

interface DependencySpecificationMap {
  [dependency_name: string]: DependencySpecification;
}

interface ServiceDefinition {
  labels: string[];
  depends_on?: string[] | DependencySpecificationMap;
  healthcheck?: Record<string, any>;
}

interface InventoryCache {
  hash: string;
  services: Service[];
  modules: Module[]
}

const hasDependencies = (serviceDefinition: Partial<Service>) => {
    const dependsOn = serviceDefinition.dependsOn || [];

    let outcome = false;

    if (Array.isArray(dependsOn) && dependsOn.length > 0) {
        outcome = true;
    }

    if (dependsOn && !Array.isArray(dependsOn) && Object.keys(dependsOn).length > 0) {
        outcome = true;
    }

    return outcome;
};

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
        const partialServices: Partial<Service>[] = this.serviceFiles
            .flatMap(filePath => {
                return {
                    module: basename(dirname(filePath)),
                    services: yaml.parse(readFileSync(filePath).toString()).services as { [serviceName: string]: ServiceDefinition },
                    source: filePath
                };
            })
            .reduce(collect((item: {
      module: string,
      services: {[serviceName: string]: ServiceDefinition},
      source: string
    }) => {
                return Object.entries(item.services)
                    .map(([serviceName, serviceDefinition]: [string, ServiceDefinition]) => {
                        function findLabel (labels: string[], prefix: string): string | undefined {
                            const value = labels.find(label => label.startsWith(prefix));
                            if (value) {
                                return value.substring(value.indexOf("=") + 1);
                            }
                            return undefined;
                        }

                        const repository = findLabel(serviceDefinition.labels, "chs.repository.url");

                        return {
                            name: serviceName,
                            module: item.module,
                            description: findLabel(serviceDefinition.labels, "chs.description"),
                            // eslint-disable-next-line no-negated-condition
                            repository: repository && repository !== null
                                ? {
                                    url: findLabel(serviceDefinition.labels, "chs.repository.url") as string,
                                    branch: findLabel(serviceDefinition.labels, "chs.repository.branch")
                                }
                                : undefined,
                            source: item.source,
                            dependsOn: serviceDefinition.depends_on,
                            builder: findLabel(serviceDefinition.labels, "chs.local.builder") || "",
                            metadata: {
                                repoContext: findLabel(serviceDefinition.labels, "chs.local.repoContext"),
                                ingressRoute: serviceDefinition.labels.find(label => label.startsWith("traefik.http.routers.")),
                                healthcheck: serviceDefinition.healthcheck?.test,
                                languageMajorVersion: findLabel(serviceDefinition.labels, "chs.local.builder.languageVersion")
                            }
                        } as Service;
                    });
            }), []);

        const exploreDependencies = (dependencies: string[] | DependencySpecificationMap | undefined): string[] => {
            if (typeof dependencies === "undefined") {
                return [];
            }

            const dependencyNames: string[] = Array.isArray(dependencies)
                ? dependencies
                : Object.keys(dependencies);

            return dependencyNames
                .flatMap((dependentServiceName: string) => {
                    const dependentService = partialServices
                        .filter((service: Partial<Service>) => hasDependencies(service))
                        .find((service: Partial<Service>) => service.name === dependentServiceName);

                    if (dependentService) {
                        return [
                            dependentServiceName,
                            // @ts-ignore
                            ...exploreDependencies(dependentService.dependsOn)
                        ];
                    }
                    return [dependentServiceName];
                }).reduce(deduplicate, []);
        };

        return partialServices
            .flatMap(
                (partialService: Partial<Service>) => {
                    return {
                        ...partialService,
                        dependsOn: exploreDependencies(partialService.dependsOn)
                    } as Service;
                }
            );
    }

    private hashServiceFiles () {
        const sha256Hash = createHash("sha256");

        this.serviceFiles
            .map(serviceFile => readFileSync(serviceFile))
            .forEach(serviceFile => {
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
