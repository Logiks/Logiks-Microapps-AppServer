"use strict";

// Boots a bare Moleculer broker (no gateway, no transporter, no DB) that
// loads only the service files it's given, so individual services' action
// logic can be exercised with broker.call() directly - skipping the HTTP
// gateway, auth and the rest of the real app's bootstrap entirely. Only
// services with no DB/cache dependency in the code paths under test are
// realistic candidates for this; anything else belongs in tests/http.
const { ServiceBroker } = require("moleculer");

async function createTestBroker(serviceFiles = []) {
	const broker = new ServiceBroker({
		nodeID: `test-unit-${process.pid}-${Date.now()}`,
		transporter: null,
		logger: false
	});

	serviceFiles.forEach((file) => broker.loadService(file));

	await broker.start();

	return broker;
}

module.exports = { createTestBroker };
