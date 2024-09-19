import { expect } from "@jest/globals";
import { join } from "path";
import { readServices } from "../../src/state/service-reader";
import Service from "../../src/model/Service";

const infraServiceFile = join(
    process.cwd(),
    "test/data/service-reader/infrastructure/mongo.docker-compose.yaml"
);

const simpleServiceFile = join(
    process.cwd(),
    "test/data/service-reader/modules/module-one/simple-service.docker-compose.yaml"
);

const moreComplexServiceFile = join(
    process.cwd(),
    "test/data/service-reader/modules/module-two/more-complex.docker-compose.yaml"
);

const atypicalServiceFile = join(
    process.cwd(),
    "test/data/service-reader/modules/module-three/atypical.docker-compose.yaml"
);

const anotherAtypicalServiceFile = join(
    process.cwd(),
    "test/data/service-reader/modules/module-three/another-atypical.docker-compose.yaml"
);

const repositoryRequiredServiceFile = join(
    process.cwd(),
    "test/data/service-reader/modules/module-one/repository-required.docker-compose.yaml"
);

const deprecatedServiceFile = join(
    process.cwd(),
    "test/data/service-reader/modules/module-three/deprecated-service.docker-compose.yaml"
);

const normaliseLocations = (svcs: Partial<Service>[]) => {
    return svcs.map(svc => {
        svc.source = svc.source?.replace(process.cwd(), ".");
        return svc;
    });
};

describe("readServices", () => {

    it("loads an infrastructure service", () => {
        expect(normaliseLocations(readServices(infraServiceFile))).toMatchSnapshot();
    });

    it("loads a simple service", () => {
        expect(normaliseLocations(readServices(simpleServiceFile))).toMatchSnapshot();
    });

    it("loads a more complicated", () => {
        expect(normaliseLocations(readServices(moreComplexServiceFile))).toMatchSnapshot();
    });

    it("loads atypical with repoContext", () => {
        expect(normaliseLocations(readServices(atypicalServiceFile))).toMatchSnapshot();
    });

    it("loads atypical with entrypoint and outdir", () => {
        expect(normaliseLocations(readServices(anotherAtypicalServiceFile))).toMatchSnapshot();
    });

    it("loads service with repo required", () => {
        expect(normaliseLocations(readServices(repositoryRequiredServiceFile))).toMatchSnapshot();
    });

    it("loads a deprecated service", () => {
        expect(normaliseLocations(readServices(deprecatedServiceFile))).toMatchSnapshot();
    });
});
