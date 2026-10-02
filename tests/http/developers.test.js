"use strict";

const { createClient } = require("./helpers/client");

// developers.* and developers.swagger.* are dev/UAT-only tools: in prod or
// staging their actions list is empty (see api/services/developers/*.js),
// so the alias itself won't exist there and a 404 is the correct result.
describe("developers (dev/UAT-only tooling)", () => {
	const client = createClient();

	test("GET /api/public/developers/routes.json lists routes where available", async () => {
		const res = await client.get("/api/public/developers/routes.json");
		expect([200, 404]).toContain(res.status);
		if (res.status === 200) {
			expect(res.data).toBeDefined();
		}
	});

	test("GET /api/public/developers/swagger/openapi.json serves a live spec where available", async () => {
		const res = await client.get("/api/public/developers/swagger/openapi.json");
		expect([200, 404]).toContain(res.status);
		if (res.status === 200) {
			expect(res.data).toHaveProperty("openapi");
			expect(res.data).toHaveProperty("paths");
		}
	});
});
