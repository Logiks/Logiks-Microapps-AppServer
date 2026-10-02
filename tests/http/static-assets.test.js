"use strict";

const { createClient } = require("./helpers/client");

// public/ is served as static assets regardless of environment (see the
// `assets` setting in api/server.js), so these should always be reachable.
describe("Static assets", () => {
	const client = createClient();

	test("serves the OpenAPI static viewer", async () => {
		const res = await client.get("/openapi/index.html");
		expect(res.status).toBe(200);
	});

	test("serves the committed OpenAPI spec as JSON", async () => {
		const res = await client.get("/openapi/openapi.json");
		expect(res.status).toBe(200);
		expect(res.data).toHaveProperty("openapi");
		expect(res.data).toHaveProperty("paths");
	});

	test("serves the API explorer", async () => {
		const res = await client.get("/explorer/index.html");
		expect(res.status).toBe(200);
	});
});
