import { expect } from "@jest/globals";
import relativiseServicePath from "../../../../src/generator/development/utils/relativise-path";

describe("relativisePath", () => {

    it("creates relative path of destination to source and then corrects to path", () => {
        const paths = "my-env.env";
        const source = "/User/tester/project/services/modules/module-a/service-f.docker-compose.yaml";
        const destination = "/User/tester/project/local/service-f/";

        expect(relativiseServicePath(paths, source, destination)).toEqual(
            "../../services/modules/module-a/my-env.env"
        );
    });

    it("can handle array", () => {
        const paths = ["my-env.env", "../module-b/another-env", "envs/env2.env"];
        const expectedPaths = [
            "../../services/modules/module-a/my-env.env",
            "../../services/modules/module-b/another-env",
            "../../services/modules/module-a/envs/env2.env"
        ];
        const source = "/User/tester/project/services/modules/module-a/service-f.docker-compose.yaml";
        const destination = "/User/tester/project/local/service-f/";

        expect(relativiseServicePath(paths, source, destination)).toEqual(
            expectedPaths
        );
    });
});
