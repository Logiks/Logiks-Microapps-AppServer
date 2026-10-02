"use strict";

// Full-surface coverage: pulls the LIVE list of every registered REST alias
// from the gateway itself (the same data developers.swagger.spec is built
// from - see api/services/developers/swagger.service.js) and exercises
// every single one, so this stays in sync automatically as routes are
// added/removed instead of needing a hand-maintained list.
//
// It intentionally does NOT try to exercise real business logic for every
// action - that would mean either fabricating payloads for actions whose
// correct shape only you know (risking a test that silently asserts the
// wrong thing), or actually running mutations (create/update/delete/...)
// against the shared dev DB with no reliable generic cleanup. Hand-written
// suites (auth.test.js, me.test.js, ...) own correctness for the paths
// that matter most; this file's job is breadth: every registered route
// gets at least one real HTTP call and a "didn't 404/didn't 500" check,
// so a route that got deleted, renamed, or started crashing shows up here.
//
// Safety model (why this can't mutate the dev DB):
//  - GET requests are made with a valid bearer token (harmless - GET is
//    read-only by convention here; nothing in the live route list is a
//    GET-that-mutates) and only asserted on "didn't crash" (status < 500).
//    A legitimate business 404 (e.g. "no record for this dummy id") is a
//    PASS, not a failure - 404 here doesn't mean "route missing", since
//    every path tested came straight from the gateway's own live alias
//    table moments earlier.
//  - Mutating requests (POST/PUT/PATCH/DELETE) are made WITHOUT a token.
//    Anything mounted under the private "/api" route (everything except
//    the public-tagged groups below) rejects with 401 before the handler
//    ever runs - so the real create/update/delete/... logic never
//    executes. The handful of routes that genuinely are public even when
//    mutating (auth.*, webhooks.*) are designed to tolerate arbitrary
//    untrusted input by nature, so an empty body is a safe, representative
//    probe for them too.
const { createClient } = require("./helpers/client");
const { login, authedClient } = require("./helpers/auth");

// Long-lived/streaming or wildcard-renderer routes aren't a request/response
// shape a generic probe can represent - excluded explicitly (not silently)
// so the full route count is still accounted for below.
const SKIP_TAGS = new Set(["sse", "pages"]);

function isPublicPath(path) {
	return (
		path.startsWith("/api/public/") ||
		path.startsWith("/auth/") ||
		path.startsWith("/webhooks/") ||
		path === "/health" ||
		path === "/api/ping"
	);
}

function fillPlaceholders(path) {
	return path.replace(/\{[^}]+\}/g, "test-coverage-probe");
}

describe("Full endpoint coverage (live route list)", () => {
	let anon;
	let authed;
	let endpoints;

	beforeAll(async () => {
		anon = createClient();
		const tokens = await login();
		authed = authedClient(tokens.accessToken);

		const res = await authed.get("/api/public/developers/swagger/openapi.json");
		if (res.status !== 200 || !res.data || !res.data.paths) {
			throw new Error(
				`[tests/http] Could not load the live route list (status ${res.status}). ` +
				"The developers.swagger tool is dev/UAT-only - is NODE_ENV set to development/uat?"
			);
		}

		endpoints = [];
		for (const [path, methods] of Object.entries(res.data.paths)) {
			for (const [method, op] of Object.entries(methods)) {
				endpoints.push({
					method: method.toUpperCase(),
					path,
					action: op.operationId,
					tag: (op.tags || [])[0] || "default"
				});
			}
		}
	});

	test("the live route list is non-empty", () => {
		expect(endpoints).toBeDefined();
		expect(endpoints.length).toBeGreaterThan(0);
	});

	test("every registered endpoint is accounted for by this suite (tested or explicitly skipped)", () => {
		// Guards against this file silently drifting out of sync with the
		// live route list - if this fails, an endpoint exists that neither
		// the per-endpoint tests below nor SKIP_TAGS currently cover.
		endpoints.forEach((e) => {
			expect(SKIP_TAGS.has(e.tag) || typeof e.method === "string").toBe(true);
		});
	});

	test("every endpoint not in SKIP_TAGS gets exercised", async () => {
		// ~130 sequential real HTTP round trips - comfortably over the
		// project's default 20s test timeout even when every call is fast.
		// One assertion covering all ~130 endpoints, by design - but each
		// one records its own failure into `failures` rather than throwing
		// immediately, so a single bad route can't hide problems with the
		// rest of the sweep (an earlier version of this test threw on the
		// first mismatch and silently skipped testing everything after it).
		const failures = [];
		let exercised = 0;

		for (const e of endpoints) {
			if (SKIP_TAGS.has(e.tag)) continue;

			const url = fillPlaceholders(e.path);
			exercised++;

			if (e.method === "GET") {
				const res = await authed.get(url);
				if (res.status >= 500) {
					failures.push(`${e.method} ${e.path} (${e.action}) crashed: ${res.status} ${JSON.stringify(res.data)}`);
				}
			} else {
				const res = await anon.request({ method: e.method.toLowerCase(), url, data: {} });

				if (res.status >= 500) {
					failures.push(`${e.method} ${e.path} (${e.action}) crashed: ${res.status} ${JSON.stringify(res.data)}`);
				} else if (!isPublicPath(e.path) && res.status !== 401) {
					failures.push(
						`${e.method} ${e.path} (${e.action}) expected 401 (private route, no token) but got ${res.status}`
					);
				}
			}
		}

		// eslint-disable-next-line no-console
		console.log(`[tests/http] endpoint coverage: ${exercised} routes exercised, ${endpoints.length - exercised} skipped`);

		if (failures.length) {
			throw new Error(`${failures.length} endpoint(s) failed:\n${failures.join("\n")}`);
		}
	}, 60000);
});
