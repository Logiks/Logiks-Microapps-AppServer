"use strict";

const { createClient } = require("./helpers/client");
const { login } = require("./helpers/auth");

describe("Auth (public)", () => {
	const client = createClient();

	test("rejects invalid credentials", async () => {
		const res = await client.post("/auth/login", {
			username: "definitely-not-a-real-user",
			password: "wrong-password",
			deviceType: "web"
		});
		expect(res.status).toBe(401);
	});

	test("issues an access + refresh token for valid credentials", async () => {
		const tokens = await login();
		expect(typeof tokens.accessToken).toBe("string");
		expect(tokens.accessToken.length).toBeGreaterThan(0);
		expect(typeof tokens.refreshToken).toBe("string");
	});
});
