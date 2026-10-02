"use strict";

// api/services/**/*.service.js files are required directly (not through the
// real app bootstrap in index.js), so the handful of bare globals they touch
// at module-eval time - not inside a handler - need to exist first. This is
// the minimal subset (found by actually requiring every service file and
// following the ReferenceErrors) rather than replicating all of index.js:
// real DB/cache/transporter connections are intentionally NOT started here,
// so anything that calls through to them belongs in tests/http, not here.
global._ = global._ || require("lodash");
global.fs = global.fs || require("fs");
global.path = global.path || require("path");
global.axios = global.axios || require("axios");
global.moment = global.moment || require("moment");
global.crypto = global.crypto || require("crypto");

global.ROOT_PATH = global.ROOT_PATH || require("path").resolve(__dirname, "../../..");
global.isProd = false;
global.isStaging = false;

global.CONFIG = global.CONFIG || Object.assign(
	{},
	require("../../../config.json"),
	require("../../../system.json")
);

// auth.service.js wires a Redis error listener on `_CACHE.getRedisInstance()`
// at require time. A fake stub is enough to satisfy that shape without a
// live Redis connection.
global._CACHE = global._CACHE || {
	getRedisInstance: () => ({ on: () => {} }),
	initialize: async () => {},
	fetchDataSync: async () => ({})
};
