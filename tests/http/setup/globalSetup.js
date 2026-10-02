"use strict";

// This suite is deliberately a client, not a bootstrapper: it validates
// whatever AppServer instance you point it at (your local dev server, a
// staging box, prod-read-only checks) rather than spawning one itself -
// spinning up the real app would need its own DB/Redis/transporter anyway,
// so there's nothing gained by duplicating that here. Point TEST_BASE_URL
// at the instance to revalidate; it defaults to the local dev server.
const axios = require("axios");

const DEFAULT_PORT = process.env.PORT || 9999;
const DEFAULT_BASE_URL = `http://localhost:${DEFAULT_PORT}`;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30000;

module.exports = async function globalSetup() {
	const baseURL = process.env.TEST_BASE_URL || DEFAULT_BASE_URL;
	const deadline = Date.now() + POLL_TIMEOUT_MS;

	let lastError;
	while (Date.now() < deadline) {
		try {
			const res = await axios.get(`${baseURL}/health`, { timeout: 2000 });
			if (res.status === 200 && res.data && res.data.status === "ok") {
				// Sub-process env mutations here propagate to the test workers,
				// since globalSetup runs before Jest forks them.
				process.env.TEST_BASE_URL = baseURL;
				console.log(`\n[tests/http] target AppServer healthy at ${baseURL}\n`);
				return;
			}
		} catch (err) {
			lastError = err;
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	throw new Error(
		`[tests/http] No AppServer reachable at ${baseURL}/health after ${POLL_TIMEOUT_MS}ms.\n` +
		"Start it first (npm start), or set TEST_BASE_URL to point at a running dev/staging instance.\n" +
		`Last error: ${lastError && lastError.message}`
	);
};
