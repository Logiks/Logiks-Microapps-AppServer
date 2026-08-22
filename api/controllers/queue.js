// Logiks Queue Controller that helps control and consume tasks across nodes

const QueueManager = require("./queue/QueueManager");
const QueueMessage = require("./queue/QueueMessage");

let QUEUE = false;
let QUEUE_KEY = "lgksQueue";
let QUEUE_LIST = [];

module.exports = {

    initialize: async function() {
        if(CONFIG.queue==null || CONFIG.queue.enable===false) return;

        const driver = CONFIG.queue?.driver || "nats";

        QUEUE = new QueueManager({
            driver: driver,
            servers: CONFIG.queue.host,
            // name: `worker-${process.pid}`
        });
        await QUEUE.connect();
        //await queue.disconnect();
        console.log("\x1b[36m%s\x1b[0m",`QUEUE Controller Initialized - ${driver}`);
        return true;
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

        const queueKey = `${QUEUE_KEY}.guid.${taskKey}`;
        payload.guid = guid;
        const result = await QUEUE.publish(queueKey, payload);

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