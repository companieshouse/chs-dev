import { expect, jest } from "@jest/globals";
import * as link from "../../src/helpers/link";

describe("displayLink", () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockReturnValue(undefined);

    const isLinkSupported = jest.spyOn(link, "isLinkSupported");
    const linkSpy = jest.spyOn(link, "formatLink").mockImplementation((text: string, url: string) => `<link>${text} - ${url}</link>`);

    it("prints out the link with title to the console so that it can be clicked", () => {
        isLinkSupported.mockReturnValue(true);

        const linkUrl = "https://start.spring.io/";
        const title = "Complete the Spring Initializr form to generate your project and click 'Share' to get the link.";

        link.displayLink(linkUrl, title);

        expect(consoleLogSpy).toBeCalledWith(`<link>${title} - ${linkUrl}</link>`);
    });

    it("prints out text and link when supportsHyperlinks is false", () => {
        isLinkSupported.mockReturnValue(false);

        const linkUrl = "https://start.spring.io/";
        const title = "Complete the Spring Initializr form to generate your project and click 'Share' to get the link.";

        link.displayLink(linkUrl, title);

        expect(consoleLogSpy).toBeCalledWith(`${title} - (\u200B${linkUrl}\u200B)`);
    });
});
