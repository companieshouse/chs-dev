import { displayLink } from "../../../helpers/link.js";
import { constructInitializrLink } from "../../../helpers/spring-boot-initializr-link.js";
import { confirm, input } from "../../../helpers/user-input.js";
import NewServiceSpec from "../../../model/NewServiceSpec.js";
import { applySelector } from "../utils.js";

/**
 * A prompt that will ask the user to provide a link to the Spring Initializr.
 * Provides a default link based on the service specification.
 */
export default class SpringBootInitializrLinkPrompt {

    // eslint-disable-next-line no-useless-constructor
    constructor (
        public readonly selector: string
    ) {}

    /**
     * Predicate to determine if this prompt should be used for the given service spec.
     * This ensures only JAVA MICROSERVICES use this prompt.
     * @param newServiceSpec being created
     * @returns true if the service spec is a JAVA MICROSERVICE
     */
    predicate (newServiceSpec: Partial<NewServiceSpec>) {
        return newServiceSpec.type?.name === "MICROSERVICE" && newServiceSpec.type?.language === "JAVA";
    }

    /**
     * Adds the link to the Spring Initializr to the service spec.
     * @param newServiceSpec being created
     * @returns the new service spec with the link to the Spring Initializr
     */
    async make (newServiceSpec: Partial<NewServiceSpec>) {
        while (true) {
            console.log("For Java projects, you can use the Spring Initializr to generate your project. Click the link below to get started.");

            displayLink(
                constructInitializrLink(newServiceSpec),
                "Open Spring Initializr"
            );

            let link = await input("Enter the link to the project shared from Spring Initializr");

            if (typeof link === "undefined" || link === null || link === "") {
                if (await confirm("No link provided. Would you like to use the default link?")) {
                    link = constructInitializrLink(newServiceSpec);
                } else {
                    continue;
                }
            }

            return applySelector(newServiceSpec, this.selector, link);
        }
    }
}
