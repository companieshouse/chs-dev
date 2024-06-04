export default {
    verbose: true,
    testPathIgnorePatterns: [
        "/node_modules",
        "/dist",
        "/lib"
    ],
    collectCoverageFrom: [
        "./src/**/*.ts"
    ],
    preset: "ts-jest",
    testEnvironment: "node",
    testTimeout: 10000,
    testMatch: [
        "**/test/**/*.spec.[jt]s"
    ],
    transform: {
        "^.+\\.tsx?$": "ts-jest",
    },
}
