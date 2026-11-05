import { join } from 'node:path';
import { type Mapping, ProjectError } from './compose.js';
import { optionalFile, type ProjectFs } from './files.js';

export const awsSessionVariables = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
] as const;

const standardInitLines = [
    'SCRIPT_DIR=$(cd "$(dirname -- "$0")" && pwd)',
    "CUSTOM_SCRPTS_DIR='custom-init-scripts'",
    '"${SCRIPT_DIR}/${CUSTOM_SCRPTS_DIR}/set_aws_session_vars.sh" > aws-session.env',
];

export const standardAwsExportLines = Object.freeze([
    'profile="development-eu-west-2"',
    'prefix=""',
    'while getopts "p:s:" opt; do',
    'case "$opt" in',
    'p) profile="$OPTARG" ;;',
    's) prefix="$OPTARG" ;;',
    '*) echo "Usage: $0 [-p profile] [-s prefix_string]"; exit 1 ;;',
    'esac',
    'done',
    'shift $((OPTIND-1))',
    '[ "${1:-}" = "--" ] && shift',
    'aws configure export-credentials --profile "$profile" --format env | while read -r line; do',
    'line="${line#export }"',
    'if [[ "$line" == AWS_CREDENTIAL_EXPIRATION=* ]]; then',
    'continue',
    'fi',
    'if [[ -n "$prefix" ]]; then',
    'line="${line//AWS_/$prefix}"',
    'fi',
    'echo "$line"',
    'done',
]);

const scriptLines = (script: string) =>
    script
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((line, index) => line === b[index]);

/**
 * The project's `custom-init.sh` only writes AWS session credentials to `aws-session.env`.
 * It is recognised rather than executed, and services reading that file receive the
 * credentials through Compose interpolation instead, so no secret is written to disk.
 */
export async function initialize(
    fs: ProjectFs,
    project: string,
    document: Mapping,
): Promise<string[]> {
    const script = await optionalFile(fs, join(project, 'custom-init.sh'));
    if (script === undefined) return [];
    if (!same(scriptLines(script), standardInitLines))
        throw new ProjectError(
            'custom-init.sh is not the standard AWS session script and cannot be run by chs-dev',
        );
    const helper = await optionalFile(
        fs,
        join(project, 'custom-init-scripts/set_aws_session_vars.sh'),
    );
    if (!helper || !same(scriptLines(helper), standardAwsExportLines))
        throw new ProjectError(
            'custom-init-scripts/set_aws_session_vars.sh is not the standard AWS session helper',
        );
    for (const spec of Object.values(document.services as Mapping)) {
        const files: (string | Mapping)[] = spec.env_file ?? [];
        const sessionFiles = files.filter((file) =>
            (typeof file === 'string' ? file : file.path).endsWith(
                '/aws-session.env',
            ),
        );
        if (!sessionFiles.length) continue;
        spec.env_file = files.filter((file) => !sessionFiles.includes(file));
        if (Array.isArray(spec.environment)) {
            spec.environment = Object.fromEntries(
                spec.environment.map((item: string) => {
                    const index = item.indexOf('=');
                    return index < 0
                        ? [item, null]
                        : [item.slice(0, index), item.slice(index + 1)];
                }),
            );
        }
        spec.environment = {
            ...spec.environment,
            ...Object.fromEntries(
                awsSessionVariables.map((name) => [name, `\${${name}}`]),
            ),
        };
    }
    return [...awsSessionVariables];
}
