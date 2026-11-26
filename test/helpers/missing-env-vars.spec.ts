/* eslint-disable no-template-curly-in-string */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { findMissingEcsEnvVars, findMissingEnvVars } from "../../src/helpers/missing-env-vars";

describe("missing-env-vars", () => {
    let dir: string;

    beforeAll(() => {
        dir = mkdtempSync("missing-env-vars");
        mkdirSync(join(dir, "repositories/svc"), { recursive: true });
        mkdirSync(join(dir, "repositories/ok"), { recursive: true });
        writeFileSync(join(dir, ".env"), "SECRET=abc\n");
        writeFileSync(join(dir, "global.env"), "URL=http://x\n");
        writeFileSync(join(dir, "repositories/svc/chs-dev.env"), [
            "# comment",
            "A=${URL}/p",
            "B=${SECRET}",
            "C=${NOPE}",
            "D=${DEFAULTED:-x}",
            "E=${REQUIRED:?must be set}",
            "F=plain",
            "G=${F}"
        ].join("\n"));
        writeFileSync(join(dir, "repositories/ok/chs-dev.env"), "A=${SECRET}\n");
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("reports variables absent from the compose env files, config env and process env", () => {
        expect(findMissingEnvVars(dir, [
            { name: "svc-web", repository: { url: "git@github.com:companieshouse/svc.git" } },
            { name: "ok", repository: null },
            { name: "no-file", repository: null }
        ]))
            .toEqual({ "svc-web": ["NOPE", "REQUIRED"] });
    });

    it("reports variables absent from the ECS env files separately", () => {
        mkdirSync(join(dir, "ecs/ecs-service-configs-dev/development-eu-west-2/cidev"), { recursive: true });
        writeFileSync(join(dir, "ecs/ecs-service-configs-dev/development-eu-west-2/cidev/ok.env"), "X=${VAULT_ONLY}\n");

        expect(findMissingEcsEnvVars(dir, [{ name: "ok", repository: null }, { name: "svc-web", repository: null }], { ECS_CONFIG_PATH: "ecs" }))
            .toEqual({ ok: ["VAULT_ONLY"] });
    });
});
