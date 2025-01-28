import CONSTANTS from "../model/Constants.js";
import NewServiceSpec from "../model/NewServiceSpec.js";

/**
 * Construct the link to the Spring Initializr for given service spec.
 * @param newServiceSpec Service Specification being constructed
 * @returns the link to the Spring Initializr for the given service spec
 */
export const constructInitializrLink = (newServiceSpec: Partial<NewServiceSpec>) => {
    const pathParts = Object.entries(springInitializrProperties(newServiceSpec))
        .filter(value => typeof value !== "undefined")
        // @ts-expect-error  value is never undefined
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);

    return `${CONSTANTS.SPRING_BOOT_INITIALIZR_URL}#!${pathParts.join("&")}`;
};

const springInitializrProperties = (newServiceSpec: Partial<NewServiceSpec>) => {
    const replaceNonAlphaNumeric = (name: string) => name.replace(/[^A-Za-z0-9]/, "");
    const toProper = (name: string) => name.split("-")
        .map(word => word.substring(0, 1).toUpperCase() + word.substring(1).toLowerCase())
        .join("");
    const toPackageName = (name: string) => replaceNonAlphaNumeric(name).toLowerCase();

    const applicationName = newServiceSpec.name;
    const applicationDescription = newServiceSpec.description;

    const javaPackage = applicationName ? `${CONSTANTS.JAVA_BASE_PACKAGE}.${toPackageName(applicationName)}` : undefined;
    const defaultSpringDependencies = CONSTANTS.SPRING_BOOT_DEPENDENCIES.join(",");

    const properApplicationName = applicationName
        ? `${toProper(applicationName)}`
        : undefined;

    const artifactId = applicationName
        ? toPackageName(applicationName)
        : undefined;

    return {
        applicationName: `${properApplicationName}Application`,
        artifactId,
        bootVersion: CONSTANTS.SPRING_BOOT_VERSION,
        dependencies: defaultSpringDependencies,
        description: applicationDescription,
        groupId: CONSTANTS.JAVA_BASE_PACKAGE,
        javaVersion: CONSTANTS.JAVA_VERSION,
        name: properApplicationName,
        type: CONSTANTS.JAVA_PROJECT_TYPE,
        version: "unversioned",
        packageName: javaPackage
    };
};
