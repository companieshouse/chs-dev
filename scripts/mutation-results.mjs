export function tapSummary(output) {
    const count = (label) =>
        Number(
            output.match(new RegExp(`^# ${label} (\\d+)\\r?$`, 'm'))?.[1] ?? 0,
        );
    return {
        tests: count('tests'),
        pass: count('pass'),
        fail: count('fail'),
        skipped: count('skipped'),
        cancelled: count('cancelled'),
    };
}

function hasInfrastructureFailure(result) {
    return (
        result.error ||
        result.teardownError ||
        result.signal ||
        result.tap.tests === 0 ||
        result.tap.cancelled > 0
    );
}

function passedTests(result) {
    return (
        result.exitCode === 0 && result.tap.fail === 0 && result.tap.pass > 0
    );
}

function diagnosticFields(output) {
    const fields = [];
    let indentation;
    for (const line of output.split('\n')) {
        if (indentation === undefined) {
            indentation = /^( +)---\r?$/.exec(line)?.[1];
            continue;
        }
        if (line.trimEnd() === `${indentation}...`) {
            indentation = undefined;
            continue;
        }
        const field = line.slice(indentation.length);
        if (line.startsWith(indentation) && /^[a-zA-Z]\w*:/.test(field))
            fields.push(field);
    }
    return fields;
}

export function classifyRun(result) {
    if (result.timedOut) return 'timeout';
    if (hasInfrastructureFailure(result)) return 'infrastructure-error';
    if (passedTests(result)) return 'survived';
    const fields = diagnosticFields(result.output);
    if (
        fields.some((field) =>
            /^code: ['"]?(?:ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION)/.test(
                field,
            ),
        )
    )
        return 'invalid';
    if (fields.some((field) => /^exitCode: [1-9]/.test(field))) {
        return /SyntaxError|TransformError/.test(result.output)
            ? 'invalid'
            : 'infrastructure-error';
    }
    if (
        result.tap.fail > 0 &&
        /code: ['"]?ERR_ASSERTION|failureType: ['"]?testCodeFailure/.test(
            result.output,
        )
    )
        return 'killed';
    return 'infrastructure-error';
}

export function summarize(results) {
    const counts = {};
    for (const result of results)
        counts[result.status] = (counts[result.status] ?? 0) + 1;
    const scored = (counts.killed ?? 0) + (counts.survived ?? 0);
    return {
        counts,
        mutationScore: scored ? (counts.killed ?? 0) / scored : null,
        scored,
    };
}
