/**
 * Simple predicate to identify whether the supplied command or args suggest
 * that hook execution is not required (i.e. running help or version or the
 * like)
 * @param commandId String containing the command name
 * @param argv array containing any arguments passed to the command
 * @returns boolean indicating whether the hook should run
 */
export const hookFilter = (commandId: string | undefined, argv: string[]) => {
    let required: boolean = true;

    const optionalCommands = [
        "help",
        "readme",
        "--version",
        "--help",
        "autocomplete",
        "autocomplete:script",
        "request"
    ];

    console.log("commandId: ", commandId);

    if (commandId && optionalCommands.some(optionalCommand => commandId.includes(optionalCommand))) {
        required = false;
    }

    if (argv && argv.some(arg => arg === "--help")) {
        required = false;
    }

    return required;
};
