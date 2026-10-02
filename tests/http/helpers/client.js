"use strict";

const axios = require("axios");

function createClient(extraHeaders = {}) {
	return axios.create({
		baseURL: process.env.TEST_BASE_URL,
		timeout: 15000,
		// Let tests assert on status codes themselves instead of catching.
		validateStatus: () => true,
		headers: extraHeaders
	});
}

module.exports = { createClient };
