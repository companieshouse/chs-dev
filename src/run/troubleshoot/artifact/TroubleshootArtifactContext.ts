import { writeFileSync } from "fs";
import Config from "../../../model/Config.js";
import { join } from "path";

/**
 * Provides a catch all place for contextual information about the environment
 * which is pertinent to the actions and state of the system
 */
export type TroubleshootArtifactContext = {

    /**
     * Appends the additional context to the current context
     * @param additionalContext being appended
     */
    append: (additionalContext: Record<string, any>) => void

    /**
     * Writes the context out to the file
     */
    write: () => void
}

/**
 * Implementation of a TroubleshootArtifactContext which builds up a local
 * object and writes out as json to `context.json` in the output directory
 */
export class OutputTroubleshootArtifactContext {

    private context: Record<string, any>;

    constructor (
        private readonly config: Config,
        private readonly outputDirectory: string
    ) {
        this.context = {
            config: OutputTroubleshootArtifactContext.redactSensitiveInformation(
                config
            )
        };
    }

    /**
     * Appends the additionalContext record to the context. Will error if
     * supplied with another `config` value otherwise will overwrite existing
     * attributes in context
     * @param additionalContext further details for the context
     */
    append (additionalContext: Record<string, any>): void {
        if (Object.keys(additionalContext).includes("config")) {
            throw new Error("Cannot overwrite initial config");
        }

        this.context = {
            ...this.context,
            ...additionalContext
        };
    }

    /**
     * Outputs the context as JSON to the `context.json` file.
     */
    write (): void {
        writeFileSync(
            join(this.outputDirectory, "context.json"),
            Buffer.from(
                JSON.stringify({
                    ...this.context
                })
            )
        );
    }

    private static redactSensitiveInformation (config: Config): Config {
        const redactSensitiveEnvironmentVariables = (envVars: Record<string, string>) => {
            const redactedEnvVars: Record<string, string> = {};

            for (const [envVarName, envVarValue] of Object.entries(envVars)) {
                if (envVarName.includes("PASS") || envVarName.includes("SSH_") || envVarName.includes("AWS_")) {
                    redactedEnvVars[envVarName] = "<REDACTED>";
                } else {
                    redactedEnvVars[envVarName] = envVarValue;
                }
            }

            return redactedEnvVars;
        };

        return {
            ...config,
            env: redactSensitiveEnvironmentVariables(config.env)
        };
    }
}
