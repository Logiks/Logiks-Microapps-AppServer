// Logiks Queue Controller that helps control and consume tasks across nodes

const crypto = require("crypto");
const QueueManager = require("./queue/QueueManager");
const QueueMessage = require("./queue/QueueMessage");

let QUEUE = false;
let QUEUE_KEY = "lgksQueue";
let QUEUE_LIST = [];

// Every message is signed with a cluster secret and verified before its handler runs. Queue brokers accept
// whatever is published to them, and payloads carry identity (user, guid) that handlers act on, so an
// unsigned or tampered message must never be executed.
const SIG_FIELD = "__sig";
const TS_FIELD = "__ts";

function signingKey() {
    return process.env.CLUSTER_TOKEN || CONFIG?.authjwt?.secret || null;
}

// Key-order independent serialisation, so signing and verifying agree after a JSON round trip
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

function computeSignature(queueKey, payload, ts) {
    return crypto.createHmac("sha256", signingKey()).update(`${queueKey}|${ts}|${canonical(payload)}`).digest("hex");
}

function verifyMessage(queueKey, payload) {
    if (!signingKey() || !payload || typeof payload !== "object") return false;

    const { [SIG_FIELD]: sig, [TS_FIELD]: ts, ...body } = payload;
    if (!sig || !ts) return false;

    const maxAgeMs = (CONFIG?.queue?.max_age_sec || 86400) * 1000;
    if (Math.abs(Date.now() - Number(ts)) > maxAgeMs) return false;

    const expected = computeSignature(queueKey, body, ts);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

module.exports = {

    initialize: async function() {
        if(CONFIG.queue==null || CONFIG.queue.enable===false) return;

        const driver = CONFIG.queue?.driver || "nats";

        QUEUE = new QueueManager({
            driver: driver,
            servers: CONFIG.queue.host,
            // broker credentials, when the queue server requires them
            token: CONFIG.queue.token,
            user: CONFIG.queue.user,
            pass: CONFIG.queue.pass,
            // name: `worker-${process.pid}`
        });
        await QUEUE.connect();
        //await queue.disconnect();
        console.log("\x1b[36m%s\x1b[0m",`QUEUE Controller Initialized - ${driver}`);
    },

    registerQueue: function(taskKey) {
        if(QUEUE_LIST.indexOf(taskKey)<0) QUEUE_LIST.push(taskKey);
    },

    listQueues: function() {
        return QUEUE_LIST;
    },

    publish: async function(guid, taskKey, payload) {
        if(!QUEUE) {
            console.error("QUEUE Not Initiated");
            return false;
        }

        if(!signingKey()) {
            console.error("QUEUE publish refused: no CLUSTER_TOKEN or authjwt.secret to sign messages with");
            return false;
        }

        const queueKey = `${QUEUE_KEY}.guid.${taskKey}`;
        payload.guid = guid;
        const ts = Date.now();
        const signed = { ...payload, [TS_FIELD]: ts, [SIG_FIELD]: computeSignature(queueKey, payload, ts) };
        const result = await QUEUE.publish(queueKey, signed);

        SERVER.getBroker().emit("queue.created", taskKey);

        return result;
    },

    setupConsumer: async function(taskKey, funcName) {
        if(!QUEUE) {
            console.error("QUEUE Not Initiated");
            return false;
        }

        const queueKey = `${QUEUE_KEY}.guid.${taskKey}`;

        SERVER.getBroker().emit("queue.created", taskKey);

        await QUEUE.consume(queueKey, async message => {
                console.log(`[${process.pid}] Processing`,message.id);

                // Dropped (acknowledged, not retried): a retry cannot make a forged message valid
                if(!verifyMessage(queueKey, message.payload)) {
                    console.error(`[${process.pid}] QUEUE message ${message.id} rejected: missing, invalid or expired signature`, queueKey);
                    return;
                }
                const { [SIG_FIELD]: _s, [TS_FIELD]: _t, ...cleanPayload } = message.payload;
                message.payload = cleanPayload;

                // console.log(message.payload);
                if(typeof funcName == "function") {
                    const response = await funcName(message.payload);
                    log_queue_response(queueKey, message.payload, response, process.pid, message)
                } else if(typeof global[funcName] == "function") {
                    const response = await global[funcName](message.payload);
                    log_queue_response(queueKey, message.payload, response, process.pid, message)
                } else {
                    const response = await _call(funcName, message.payload);
                    log_queue_response(queueKey, message.payload, response, process.pid, message)
                }

                console.log(`[${process.pid}] Completed`,message.id);
            },{
                maxAttempts: 5,
                deadLetter: `${QUEUE_KEY}.${taskKey}.failed`
            }
        );

        console.log(
            `[${process.pid}] Worker started for - ${taskKey}`
        );
    },

    stats: async function(taskKey) {
        if(!QUEUE) {
            console.error("QUEUE Not Initiated");
            return false;
        }

        const queueKey = `${QUEUE_KEY}.guid.${taskKey}`;

        return QUEUE.stats(queueKey);
    }
}

//Log Queue Response
function log_queue_response(queueKey, payload, response, processId, message) {
    var dated = moment().format("Y-MM-DD HH:mm:ss");
    _DB.db_insertQ1("logdb", "log_queue",{
            "guid": payload.guid, 
            "queueKey": queueKey,
            "payload": JSON.stringify(payload || {}),
            "response": JSON.stringify(response || {}),
            "message": JSON.stringify(message.toString() || {}),
            "processId": process.pid,
            "blocked": "false",
            "created_on": dated,
            "created_by": payload?.userId || "-",
            "edited_on": dated,
            "edited_by": payload?.userId || "-",
        });
}