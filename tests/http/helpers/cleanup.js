"use strict";

// Any test that creates data against the shared dev DB (an uploaded file, a
// dbops row, ...) should registerCleanup() its own teardown right after
// creating it, then call runCleanup() in an afterAll. Import this fresh in
// each test file - Jest gives every test file its own module registry, so
// the registry below is already scoped per-file.
const registry = [];

function registerCleanup(fn) {
	registry.push(fn);
}

async function runCleanup() {
	while (registry.length) {
		const fn = registry.pop();
		try {
			await fn();
		} catch (err) {
			// eslint-disable-next-line no-console
			console.warn("[tests/http] cleanup step failed (continuing):", err.message);
		}
	}
}

module.exports = { registerCleanup, runCleanup };
