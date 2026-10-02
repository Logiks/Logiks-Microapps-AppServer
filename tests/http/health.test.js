"use strict";

const { createClient } = require("./helpers/client");

describe("Health (public, unauthenticated)", () => {
	const client = createClient();

	test("GET /health reports ok", async () => {
		const res = await client.get("/health");
		expect(res.status).toBe(200);
		expect(res.data.status).toBe("ok");
		expect(res.data.health).toBe("healthy");
	});

	test("GET /api/ping reports ok with a timestamp", async () => {
		const res = await client.get("/api/ping");
		expect(res.status).toBe(200);
		expect(res.data.status).toBe("ok");
		expect(typeof res.data.timestamp).toBe("number");
	});
});
