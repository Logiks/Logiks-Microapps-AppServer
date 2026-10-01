//AICore provides the AI Layer used across the platform by core and plugins
//This layer itself forms the 4th Layer for T4 archicture of Logiks
//It is an agentic AI Layer that with help of connected LLM can fully operate with the AppServer
//It is controlled by policy controls of the AICore

const { createEngines } = require("./aicore/index.js");
const AGENT_LOOP = require("./aicore/agentLoop.js");
const KNOWLEDGE = require("./aicore/knowledge.js");
const TOOLING = require("./aicore/tooling.js");
const PERSONAS = require("./aicore/personas.js");
const AGENTS = require("./aicore/agents.js");
const CONVERSATIONS = require("./aicore/conversations.js");
const BASICS = require("./aicore/basics.js");
const detectIntent = require("./aicore/intentDetector.js");

const QUEUE_TASK_KEY = "aicore.agent.run";

var ENGINES = [];
var RESILIENCE_CONFIG = {};
var INTENT_AGENT_MAP = {};
var DEFAULT_AGENT = null;

module.exports = {

    initialize: function() {
        if(!(CONFIG.aicore && CONFIG.aicore.enabled)) {
            console.log("\x1b[31m%s\x1b[0m","AICore Disabled");
            return true;
        }

        const engineConfigs = normalizeEngineConfig(CONFIG.aicore);
        ENGINES = createEngines(engineConfigs);

        RESILIENCE_CONFIG = {
            retry: CONFIG.aicore.retry || {},
            breaker: CONFIG.aicore.breaker || {}
        };

        INTENT_AGENT_MAP = CONFIG.aicore.intentAgentMap || {};
        DEFAULT_AGENT = CONFIG.aicore.defaultAgent || null;

        BASICS.configure(ENGINES, RESILIENCE_CONFIG);

        if(ENGINES.length === 0) {
            console.log("\x1b[31m%s\x1b[0m","AICore Enabled but no supported engines configured");
        } else {
            console.log("\x1b[36m%s\x1b[0m", `AICore Initialized - engines: ${ENGINES.map(e => e.key).join(", ")}`);
        }

        return true;
    },

    //Registers this node as a consumer of queued agent runs (execution_mode
    //"queue"). Called from baseapp.js's postInitalization(), after every
    //controller - including QUEUE - has had a chance to finish connecting.
    startQueueConsumer: async function() {
        if(!(CONFIG.aicore && CONFIG.aicore.enabled)) return;

        QUEUE.registerQueue(QUEUE_TASK_KEY);
        await QUEUE.setupConsumer(QUEUE_TASK_KEY, async function(payload) {
            const ctx = { meta: { user: payload.user || {} } };
            return await AGENT_LOOP.runTurn(ENGINES, RESILIENCE_CONFIG, payload.sessId, payload.agentCode, payload.message, ctx);
        });
    },

    getKnowledge: KNOWLEDGE,
    getTools: TOOLING,
    personas: PERSONAS,
    agents: AGENTS,

    //Entry point for a normal, synchronous chat turn. Resolves an agent
    //either explicitly (moduleId) or via intentDetector against the
    //configured intent->agent map, falling back to CONFIG.aicore.defaultAgent.
    sendMessage: async function(message, sessId, moduleId, params, ctx) {
        if(!sessId) sessId = UNIQUEID.generate(10);

        const agentCode = moduleId || resolveAgentFromIntent(message) || DEFAULT_AGENT;
        if(!agentCode) {
            return { sessId, status: "error", response: null, message: "No agent resolved for this request" };
        }

        try {
            return await AGENT_LOOP.runTurn(ENGINES, RESILIENCE_CONFIG, sessId, agentCode, message, ctx);
        } catch(err) {
            console.error("AICore.sendMessage failed", err);
            return { sessId, status: "error", response: null, message: err.message || String(err) };
        }
    },

    //Runs an agent turn synchronously, in this process.
    runAgent: async function(agentCode, message, sessId, ctx) {
        if(!sessId) sessId = UNIQUEID.generate(10);
        return await AGENT_LOOP.runTurn(ENGINES, RESILIENCE_CONFIG, sessId, agentCode, message, ctx);
    },

    //Publishes an agent run to the cross-node queue for async/distributed
    //execution - picked up by whichever node's startQueueConsumer() is
    //listening, with the existing QUEUE implementation's retry + dead-letter.
    queueAgentRun: async function(agentCode, message, sessId, ctx) {
        if(!sessId) sessId = UNIQUEID.generate(10);
        const guid = ctx?.meta?.user?.guid;

        await QUEUE.publish(guid, QUEUE_TASK_KEY, {
            sessId, agentCode, message, user: ctx?.meta?.user || {}
        });

        return { sessId, status: "queued" };
    },

    sessionHistory: async function(guid, sessId) {
        return await CONVERSATIONS.history(guid, sessId);
    },

    // -----------------------------------------------------------------
    // Basic utilities - single-shot, no persona/agent setup required.
    // See api/controllers/aicore/basics.js.
    // -----------------------------------------------------------------

    //summerize(input, ctx) - input: a content item, or an array of them
    //(string | {fileId} | {attachment} | {text} | {mimeType, data}).
    summerize: async function(attachment = [], ctx) {
        return await BASICS.summerize(attachment, ctx);
    },

    //extract(content, payload, ctx) - payload is a template object; every
    //key in it is a field to extract, returned with matched values filled in.
    extract: async function(content, payload = {}, ctx) {
        return await BASICS.extract(content, payload, ctx);
    },

    //classify(input, categories, ctx) -> { category, reason }
    classify: async function(input, categories = [], ctx) {
        return await BASICS.classify(input, categories, ctx);
    },

    //translate(input, targetLang, ctx) -> { text }
    translate: async function(input, targetLang, ctx) {
        return await BASICS.translate(input, targetLang, ctx);
    },

    //generate(prompt, params, ctx) -> { text } - raw single-shot completion.
    generate: async function(prompt, params = {}, ctx) {
        return await BASICS.generate(prompt, params, ctx);
    },

    //moderate(input, ctx) -> { flagged, categories, reason }
    moderate: async function(input, ctx) {
        return await BASICS.moderate(input, ctx);
    },

    //describe(attachment, ctx) -> { description } - vision, image input only.
    describe: async function(attachment, ctx) {
        return await BASICS.describe(attachment, ctx);
    },

    //ocr(attachment, ctx) -> { text } - vision, image input only.
    ocr: async function(attachment, ctx) {
        return await BASICS.ocr(attachment, ctx);
    },

    //queryNL(question, dbkey, ctx) -> { answer, data, status } - natural
    //language over the Logiks JSON query DSL (query_schema/query_results/...).
    queryNL: async function(question, dbkey = "appdb", ctx) {
        return await BASICS.queryNL(question, dbkey, ctx);
    },

    //embed(input, ctx) -> { vectors, engineKey } - first configured engine
    //that implements embeddings (today: openai only).
    embed: async function(input, ctx, params = {}) {
        return await BASICS.embed(input, ctx, params);
    },
}

//Accepts both the legacy {enabled, engine, config} shape (what the
//committed config.json actually has) and the new {enabled, engines: [...]}
//multi-engine shape, so existing deployments keep working unchanged.
function normalizeEngineConfig(aicoreConfig) {
    if(Array.isArray(aicoreConfig.engines)) return aicoreConfig.engines;

    if(aicoreConfig.engine) {
        return [{ key: aicoreConfig.engine, driver: aicoreConfig.engine, priority: 1, config: aicoreConfig.config || {} }];
    }

    return [];
}

function resolveAgentFromIntent(message) {
    const detected = detectIntent(message);
    if(detected.intent === "unknown") return null;
    return INTENT_AGENT_MAP[detected.intent] || null;
}
