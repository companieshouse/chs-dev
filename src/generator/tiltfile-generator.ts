import { writeFileSync } from "fs";
import { EOL } from "os";
import { join, relative } from "path";
import glob from "glob";

export class TiltfileGenerator {
    constructor (private path: string) {
        this.path = path;
    }

    generate (services: { name: string; liveUpdate: boolean }[], excluded: string[]): void {
        const lines = [
            "# DO NOT MODIFY MANUALLY",
            "warn(\"Using Tilt is deprecated and may be removed with little notice, please start to use the docker compose version.\")",
            `docker_compose(configPaths = [${["services/infrastructure/docker-compose.yaml", ...this.findServicesFilesWithExtension(services.map(item => item.name), "docker-compose.yaml", excluded)].map(filePath => `'${filePath}'`).join(",")}])`,
            ...this.findServicesFilesWithExtension(services.map(item => item.name), "tiltfile", excluded).map(filePath => `include(path = '${filePath}')`),
            ...services.filter(item => item.liveUpdate).map(item => `include(path = 'repositories/${item.name}/Tiltfile.dev')`)
        ];

        writeFileSync(join(this.path, "Tiltfile"), lines.join(EOL + EOL));
    }

    private findServicesFilesWithExtension (serviceNames: string[], fileExtension: string, excluded: string[]) {
        return serviceNames.filter(serviceName => !excluded.includes(serviceName))
            .map(serviceName => {
                return glob.sync(`${this.path}/services/**/${serviceName}.${fileExtension}`)
                    .map(filePath => {
                        return `${relative(this.path, filePath).replace(/\\/g, "/")}`;
                    });
            })
            .flatMap(serviceFiles => {
                // Since there may be multiple service files for a service (i.e. mongo/kafka etc)
                // prefer those which are part of the /tilt directory.
                if (serviceFiles.length === 1) {
                    return serviceFiles;
                } else {
                    return serviceFiles.filter(
                        file => file.indexOf("/tilt") > -1
                    );
                }
            })
            .sort();
    }
}
