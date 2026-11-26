/* eslint-disable no-template-curly-in-string */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveServiceEnv, writeServiceEnvFile } from "../../src/helpers/ecs-env";

describe("ecs-env", () => {
    let dir: string;
    const service = { name: "svc", module: "m", repository: { url: "git@github.com:companieshouse/svc-repo.git" } } as any;
    const shared = ["global.env", ".env"];
    const ecsDir = (env: string, repo: string, path: string) => join(dir, "ecs", repo, path, env);

    beforeAll(() => {
        dir = mkdtempSync("ecs-env");
        mkdirSync(ecsDir("cidev", "ecs-service-configs-dev", "development-eu-west-2"), { recursive: true });
        mkdirSync(ecsDir("live", "ecs-service-configs-production", "live-eu-west-2"), { recursive: true });
        mkdirSync(join(dir, "repositories/svc-repo"), { recursive: true });
        writeFileSync(join(ecsDir("cidev", "ecs-service-configs-dev", "development-eu-west-2"), "global_vars.env"), [
            "ACCOUNT_URL=https://cidev",
            "API_LOCAL_URL=${ACCOUNT_URL}/private",
            "KEEP=ecs"
        ].join("\n"));
        writeFileSync(join(ecsDir("live", "ecs-service-configs-production", "live-eu-west-2"), "global_vars.env"), "ACCOUNT_URL=https://live\n");
        writeFileSync(join(dir, "global.env"), "API_LOCAL_URL=http://local\n");
        writeFileSync(join(dir, ".env"), "SECRET=s3cr$t\n");
        writeFileSync(join(ecsDir("cidev", "ecs-service-configs-dev", "development-eu-west-2"), "svc.env"), [
            "API_LOCAL_URL=\"${API_LOCAL_URL}\"",
            "ACCOUNTS=${ACCOUNT_URL}/a",
            "TOKEN=${SECRET}",
            "VAULT=${VAULT_ONLY}",
            "DEFAULTED=${NOPE:-d}"
        ].join("\n"));
        writeFileSync(join(dir, "repositories/svc-repo/chs-dev.env"), "KEEP=local\nBUILT=${KEEP}-x\n");
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("injects only ECS service env overridden by chs-dev.env, resolved against the global and shared env", () => {
        const { env, interpolation, unresolved } = resolveServiceEnv(dir, service, shared, { ECS_CONFIG_PATH: "ecs" });

        expect(env).toMatchObject({
            API_LOCAL_URL: "http://local",
            ACCOUNTS: "https://cidev/a",
            TOKEN: "s3cr$t",
            DEFAULTED: "d",
            KEEP: "local",
            BUILT: "local-x"
        });
        expect(Object.keys(env).sort()).toEqual(
            ["ACCOUNTS", "API_LOCAL_URL", "BUILT", "DEFAULTED", "KEEP", "TOKEN", "VAULT"]
        );
        expect(interpolation).toMatchObject({ ACCOUNT_URL: "https://cidev", SECRET: "s3cr$t" });
        expect(interpolation).not.toHaveProperty("BUILT");
        expect(unresolved).toEqual([{ name: "VAULT_ONLY", layer: "ecs-service" }]);
    });

    it("uses the ECS environment selected by ECS_ENV", () => {
        expect(resolveServiceEnv(dir, service, shared, { ECS_CONFIG_PATH: "ecs", ECS_ENV: "live" }).interpolation.ACCOUNT_URL)
            .toBe("https://live");
        expect(() => resolveServiceEnv(dir, service, shared, { ECS_ENV: "nope" })).toThrow("Unknown ECS_ENV");
    });

    it("writes values literally so compose does not interpolate them, leaving unresolved references to compose", () => {
        const { path } = writeServiceEnvFile(dir, service, shared, { ECS_CONFIG_PATH: "ecs" });
        const content = readFileSync(path!).toString("utf8");

        expect(content).toContain("TOKEN='s3cr$t'");
        expect(content).toContain("VAULT=\"${VAULT_ONLY}\"");
    });
});
