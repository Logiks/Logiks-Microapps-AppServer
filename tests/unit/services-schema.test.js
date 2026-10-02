"use strict";

// Requires every *.service.js file directly (globalStubs.js makes that safe
// without a real DB/cache/transporter) and checks it still exports a valid
// Moleculer schema. This is cheap enough to run on every revalidation pass
// and catches broken requires/typos/malformed action defs immediately,
// before they'd otherwise only surface as a 500 at request time.

const fs = require("fs");
const path = require("path");

const SERVICES_DIR = path.resolve(__dirname, "../../api/services");

function findServiceFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return findServiceFiles(full);
		if (entry.isFile() && entry.name.endsWith(".service.js")) return [full];
		return [];
	});
}

describe("Service schema integrity (structural, no DB/network)", () => {
	const files = findServiceFiles(SERVICES_DIR);

	test("at least one service file was found", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	test.each(files.map((f) => [path.relative(SERVICES_DIR, f), f]))(
		"%s exports a valid Moleculer schema",
		(_label, file) => {
			let schema;
			expect(() => {
				schema = require(file);
			}).not.toThrow();

			expect(typeof schema.name).toBe("string");
			expect(schema.name.length).toBeGreaterThan(0);

			Object.entries(schema.actions || {}).forEach(([actionName, action]) => {
				const handler = typeof action === "function" ? action : action.handler;
				expect(typeof handler).toBe("function");

				if (typeof action === "object" && action.rest) {
					const restEntries = Array.isArray(action.rest) ? action.rest : [action.rest];
					restEntries.forEach((rest) => {
						if (typeof rest === "object") {
							expect(typeof rest.method).toBe("string");
						}
					});
				}
			});
		}
	);
});
