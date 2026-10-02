"use strict";

const { createClient } = require("./client");

const USERNAME = process.env.TEST_USERNAME || "admin";
const PASSWORD = process.env.TEST_PASSWORD || "admin123";

if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
	// eslint-disable-next-line no-console
	console.warn(
		"[tests/http] TEST_USERNAME/TEST_PASSWORD not set - using the default dev credentials " +
		"(admin/admin123). Set both in .env.test for any non-local target."
	);
}

async function login() {
	const client = createClient();
	const res = await client.post("/auth/login", {
		username: USERNAME,
		password: PASSWORD,
		deviceType: "web"
	});

	if (res.status !== 200 || !res.data || !res.data.accessToken) {
		throw new Error(
			`[tests/http] Login failed for "${USERNAME}": ${res.status} ${JSON.stringify(res.data)}`
		);
	}

	return res.data;
}

function authedClient(accessToken) {
	return createClient({ Authorization: `Bearer ${accessToken}` });
}

module.exports = { login, authedClient };
