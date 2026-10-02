"use strict";

// Two independent suites, selectable via `--selectProjects`:
//  - unit: pure logic + structural checks, no network/DB, runs anywhere.
//  - http: hits a live AppServer instance (local or remote) over HTTP.
// See tests/README.md for how to run the full set or just one part.
module.exports = {
	projects: [
		{
			displayName: "unit",
			testEnvironment: "node",
			rootDir: __dirname,
			testMatch: ["<rootDir>/tests/unit/**/*.test.js"],
			setupFiles: ["<rootDir>/tests/unit/setup/globalStubs.js"]
		},
		{
			displayName: "http",
			testEnvironment: "node",
			rootDir: __dirname,
			testMatch: ["<rootDir>/tests/http/**/*.test.js"],
			globalSetup: "<rootDir>/tests/http/setup/globalSetup.js",
			setupFilesAfterEnv: ["<rootDir>/tests/http/setup/jestSetup.js"]
		}
	]
};
