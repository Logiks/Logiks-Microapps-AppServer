"use strict";

const { createClient } = require("./helpers/client");
const { login, authedClient } = require("./helpers/auth");

describe("me (authenticated)", () => {
	let client;

	beforeAll(async () => {
		const tokens = await login();
		client = authedClient(tokens.accessToken);
	});

	test("GET /api/me returns the logged-in user's info", async () => {
		const res = await client.get("/api/me");
		expect(res.status).toBe(200);
		expect(res.data).toHaveProperty("info");
	});

	test("GET /api/me without a token is rejected", async () => {
		const anon = createClient();
		const res = await anon.get("/api/me");
		expect(res.status).toBe(401);
	});
});
