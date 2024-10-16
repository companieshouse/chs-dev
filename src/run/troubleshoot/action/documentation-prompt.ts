/**
 * Common prompt to user providing a web link to the documentation referenced in
 * parameter
 * @param documentationFileName path of the documentation file within the docs
 *      directory
 */
export const provideLinkToDocumentaton = (documentationFileName) => {
    const url = `https://www.github.com/companieshouse/chs-dev/blob/main/docs/${documentationFileName}`;

    console.log(`For more information refer to documentation: ${url}`);
};
