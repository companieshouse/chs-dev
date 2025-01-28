import supportsHyperlinks from "supports-hyperlinks";

// This helper function was derived from `terminal-links` and `ansi-escapes` packages
// these are not properly setup for modern ES6 imports, so we have to copy the code here

/**
 * OSC (Operating System Command) escape sequence
 */
const OSC = "\u001B]";

/**
 * SEP (separator) character
 */
const SEP = ";";

/**
 * BEL (bell) character
 */
const BEL = "\u0007";

/**
 * @returns true if the console supports hyperlinks
 */
export const isLinkSupported = () => supportsHyperlinks.stdout;

/**
 * Formats the link to be displayed in the console
 * @param text Title text to render in the console
 * @param url URL to be linked to
 * @returns formatted link text
 */
export const formatLink = (text: string, url: string) => [
    OSC,
    "8",
    SEP,
    SEP,
    url,
    BEL,
    text,
    OSC,
    "8",
    SEP,
    SEP,
    BEL
].join("");

/**
 * Prints out the link with title to the console so that it can be clicked
 * @param linkUrl url to be linked to
 * @param title Title of the url being displayed
 */
export const displayLink = (linkUrl: string, title: string) => {

    let logText: string = formatLink(title, linkUrl);

    if (!isLinkSupported()) {
        logText = `${title} - (\u200B${linkUrl}\u200B)`;
    }

    console.log(logText);
};
