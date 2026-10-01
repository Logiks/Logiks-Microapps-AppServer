/*
 * Optional local-worker lane for AICore agents (execution_mode: "local_worker").
 * Loaded by api/helpers/workers.js, either as a worker_thread or a forked
 * process depending on WORKER_MODE.
 *
 * IMPORTANT SCOPE NOTE: worker_threads/child_process each start a fresh
 * Node context - none of the main process's globals (CONFIG, _DB, AICORE,
 * ...) exist here automatically. Re-running the FULL app bootstrap
 * (api/baseapp.js's initializeApplication(), which also starts the
 * Moleculer broker and HTTP listeners) would be wrong inside a worker, so
 * this file does a deliberately PARTIAL bootstrap: just the helpers and
 * config AICore's agent loop actually needs (CONFIG, lodash, _DB, _CACHE,
 * MISC, UNIQUEID), then requires the aicore controller tree directly.
 *
 * Consequence: MCP tools that call out through the Moleculer broker
 * (registry.js's registerPluginTool path, via SERVER.getBroker().call(...))
 * will NOT work from inside this worker, since there is no broker here -
 * only system tools that talk to _DB/axios directly are safe to use on an
 * agent routed to this execution_mode. This is why "queue" (the NATS lane,
 * which runs inside a full app process) is the default distributed lane and
 * this one is opt-in only.
 */

const { parentPort } = require("worker_threads");
const path = require("path");

bootstrap();

function bootstrap() {
    global._ENV = { SERVICES: [], HELPERS: [], CONTROLLERS: [], CONTROLLERS_PUBLIC: [] };
    global._ = require("lodash");
    global.fs = require("fs");
    global.path = path;
    global.axios = require("axios");
    global.moment = require("moment");
    global.crypto = require("crypto");
    global.ROOT_PATH = path.resolve(__dirname, "../../");

    require("dotenv").config({ quiet: true });

    const packageConfig = require(path.join(global.ROOT_PATH, "package.json"));
    const tempConfig = process.env.CONFIG_TYPE === "LOCAL" ? require(process.env.CONFIG_FILE) : {};
    const systemConfig = require(path.join(global.ROOT_PATH, "system.json"));
    global.CONFIG = _.extend({}, tempConfig, systemConfig, packageConfig, {
        SERVER_ID: process.env.SERVER_ID,
        ROOT_PATH: global.ROOT_PATH
    });

    require(path.join(global.ROOT_PATH, "api/commons"));

    //Only the helpers AICore's agent loop actually touches - not the full
    //api/helpers/ autoload, to keep this worker's footprint small.
    global.MISC = require(path.join(global.ROOT_PATH, "api/helpers/misc.js"));
    global.UNIQUEID = require(path.join(global.ROOT_PATH, "api/helpers/uniqueid.js"));
    global._DB = require(path.join(global.ROOT_PATH, "api/helpers/_db.js"));
    if (typeof global._DB.initialize === "function") global._DB.initialize();

    global._CACHE = require(path.join(global.ROOT_PATH, "api/cache.js"));

    global.AICORE = require(path.join(global.ROOT_PATH, "api/controllers/aicore.js"));

    ready();
}

async function ready() {
    await _CACHE.initialize();
    AICORE.initialize();

    onMessage(async (job) => {
        try {
            const ctx = { meta: { user: job.user || {} } };
            const result = await AICORE.runAgent(job.agentCode, job.message, job.sessId, ctx);
            send({ ok: true, result });
        } catch (err) {
            send({ ok: false, error: err.message || String(err) });
        }
    });
}

function send(msg) {
    if (parentPort) parentPort.postMessage(msg);
    else process.send(msg);
}

function onMessage(handler) {
    if (parentPort) parentPort.on("message", handler);
    else process.on("message", handler);
}
