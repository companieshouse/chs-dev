import CONSTANTS from "../../../model/Constants.js";
import NewServiceSpec from "../../../model/NewServiceSpec.js";
import ConfirmPrompt from "./ConfirmPrompt.js";
import FinalConfirmationPrompt from "./FinalConfirmationPrompt.js";
import SelectPrompt from "./SelectPrompt.js";
import SpringBootInitializrLinkPrompt from "./SpringBootInitializrLinkPrompt.js";
import TextPrompt from "./TextPrompt.js";

export type Prompt = {
    make: (newServiceSpec: Partial<NewServiceSpec>) => PromiseLike<Partial<NewServiceSpec>>,
    selector: string,
    predicate?: (newServiceSpec: Partial<NewServiceSpec>) => boolean
}

const prompts: Prompt[] = [
    new TextPrompt(
        "Enter the description of the service",
        ".description"
    ),
    new SelectPrompt(
        "What type of service are you creating",
        ".type.name",
        [
            {
                value: "MICROSERVICE",
                text: "Microservice"
            }
        ]
    ),
    new SelectPrompt(
        "What language is your service",
        ".type.language",
        [
            {
                value: "JAVA",
                text: "Java"
            },
            {
                value: "NODE",
                text: "Node"
            }
        ]
    ),
    new SpringBootInitializrLinkPrompt(
        ".configuration.java.spring_initializr_url"
    ),
    new TextPrompt(
        "Enter your full name",
        ".submission_details.by.name"
    ),
    new TextPrompt(
        "Enter your GitHub username",
        ".submission_details.by.github_username"
    ),
    new SelectPrompt(
        "Select the team who will be responsible for the service",
        ".ownership.team",
        CONSTANTS.SCRUM_TEAMS.map(team => ({ value: team }))
    ),
    new SelectPrompt(
        "Select the service who will own the service",
        ".ownership.service",
        CONSTANTS.SERVICE_NAMES.map(team => ({ value: team }))
    ),
    new ConfirmPrompt(
        "Is the service sensitive in nature",
        ".sensitive"
    ),
    new TextPrompt(
        "Please explain why the service is sensitive",
        ".sensitivity_justification",
        (newServiceSpec: Partial<NewServiceSpec>) => newServiceSpec.sensitive === true
    ),
    new SelectPrompt(
        "Enter the intended audience for the source code",
        ".source_code_visibility",
        [
            {
                value: "internal",
                text: "Internal to Companies House"
            },
            {
                value: "private",
                text: "Private to particular groups in Companies House or requires extra care"
            }
        ],
        (newServiceSpec: Partial<NewServiceSpec>) => newServiceSpec.sensitive === true
    ),
    new TextPrompt(
        "Enter the module name for the docker-chs-development service",
        ".configuration.docker-chs-development.module",
        (newServiceSpec: Partial<NewServiceSpec>) =>
            typeof newServiceSpec.type !== "undefined" &&
            newServiceSpec.type.name === "MICROSERVICE"
    ),
    new TextPrompt(
        "Enter the name of the ECS Stack/cluster which this Microservice is being deployed to",
        ".configuration.deploy.stack_name",
        (newServiceSpec: Partial<NewServiceSpec>) =>
            typeof newServiceSpec.type !== "undefined" &&
                newServiceSpec.type.name === "MICROSERVICE"
    ),
    new FinalConfirmationPrompt()
];

/**
 * The list of prompts that will be used to gather the service specification.
 */
export default prompts;
