import confirm from "@inquirer/confirm";
import { Hook } from "@oclif/core";
import { writeFileSync } from "fs";
import { join } from "path";
import loadConfig from "../helpers/config-loader.js";
import { hasValidEcrLoginWithinThreshold, isForceEcrCheckEnabled } from "../helpers/ecr-login.js";
import Config from "../model/Config.js";
import { DockerEcrLogin } from "../run/docker-ecr-login.js";

/**
 * Oclif hook which will offer the user to login to ECR if not logged in
 * @param param0 contains context and config
 */
export const hook: Hook<"ensure-ecr-logged-in"> = async ({ config, context }) => {

    if (typeof process.env.CHS_DEV_SKIP_ECR_LOGIN_CHECK !== "undefined") {
        return;
    }

    const projectConfig = loadConfig();
    const executionTime = Date.now();

    const lastRunTimeFile = join(config.dataDir, `${projectConfig.projectName}.prerun.last_run_time`);

    const ecrLoginCheckProperties = {
        projectName: projectConfig.projectName,
        performEcrLoginHoursThreshold: projectConfig.performEcrLoginHoursThreshold,
        chsDevDataDir: config.dataDir,
        lastRunTimeFile,
        executionTime
    };

    const runCheck = isForceEcrCheckEnabled() || !hasValidEcrLoginWithinThreshold(ecrLoginCheckProperties);

    if (runCheck) {
        await attemptEcrLogin(config, projectConfig, context, lastRunTimeFile, executionTime);
    }
};

const attemptEcrLogin = async (
    config,
    projectConfig: Config,
    context,
    lastRunTimeFile: string,
    executionTime: number) => {
    const runLogin = await confirm({
        message: "Do you want to attempt to login to AWS ECR?"
    });

    if (runLogin) {
        const dockerEcrLogin = new DockerEcrLogin(
            config.root, {
                log: console.log
            }
        );

        let continueWithAction = true;

        try {
            await dockerEcrLogin.attemptLoginToDockerEcr();
        } catch (error) {
            console.error(error);

            continueWithAction = await confirm({
                message: "Was not able to login to ECR do you want to continue?"
            });
        }

        if (!continueWithAction) {
            context.error(new Error("not logged into AWS ECR"));
        } else {
            writeFileSync(
                lastRunTimeFile,
                new Date(executionTime).toISOString()
            );
        }

    }
};
