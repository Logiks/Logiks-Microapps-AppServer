//Basic, no-setup-required AI utilities - single-shot operations any
//microapp can call directly without first defining a persona/agent (the
//same category summerize/extract already were). Configured once by
//AICore's initialize() with the same engines/resilience config the agent
//loop uses, so these get the exact same fallback/circuit-breaker behavior
//for free - see resilience.js.

const RESILIENCE = require("./resilience.js");
const AGENT_LOOP = require("./agentLoop.js");
const { resolveContent } = require("./content.js");

let ENGINES = [];
let RESILIENCE_CONFIG = {};

function configure(engines, resilienceConfig) {
    ENGINES = engines;
    RESILIENCE_CONFIG = resilienceConfig;
}

//Single-shot, no tools - the shared primitive every function below is built on.
async function complete(systemPrompt, userContent, userInfo = {}, params = {}) {
    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
    ];
    return await RESILIENCE.callEngine(ENGINES, UNIQUEID.generate(10), messages, [], userInfo, params, RESILIENCE_CONFIG);
}

//summerize(input, ctx) - input is a single content item or an array of
//them (string | {fileId} | {attachment} | {text} | {mimeType, data}).
async function summerize(input, ctx) {
    const items = Array.isArray(input) ? input : [input];
    const resolved = await Promise.all(items.map(item => resolveContent(item, ctx)));

    const content = [{ type: "text", text: "Summarize the following content concisely." }, ...resolved];
    const result = await complete(
        "You produce clear, concise summaries of the content you're given.",
        content,
        ctx?.meta?.user || {}
    );

    return { summary: result.message };
}

//extract(content, payload, ctx) - payload is a template object; every key
//present in it is a field to extract. Returns payload with matched keys
//filled in from the content - unmatched keys keep their original value.
async function extract(content, payload = {}, ctx) {
    const resolved = await resolveContent(content, ctx);
    const keys = Object.keys(payload);

    const instruction =
        `Extract the following fields from the content and respond with ONLY a JSON object containing ` +
        `exactly these keys: ${keys.join(", ")}. If a field can't be found, use null for it. ` +
        `Do not add extra keys, explanation, or markdown formatting.\n\n` +
        `Current/default values (for type/shape reference): ${JSON.stringify(payload)}`;

    const result = await complete(
        "You extract structured data from documents and respond with strict JSON only.",
        [{ type: "text", text: instruction }, resolved],
        ctx?.meta?.user || {}
    );

    const parsed = safeParseJSON(result.message) || {};
    const updated = _.clone(payload);
    for (const key of keys) {
        if (parsed[key] !== undefined) updated[key] = parsed[key];
    }
    return updated;
}

async function classify(input, categories = [], ctx) {
    const resolved = await resolveContent(input, ctx);

    const instruction =
        `Classify the following content into exactly one of these categories: ${categories.join(", ")}. ` +
        `Respond with ONLY a JSON object: {"category": "...", "reason": "..."}.`;

    const result = await complete(
        "You classify content accurately and concisely.",
        [{ type: "text", text: instruction }, resolved],
        ctx?.meta?.user || {}
    );

    const parsed = safeParseJSON(result.message) || {};
    return { category: parsed.category || null, reason: parsed.reason || null };
}

async function translate(input, targetLang, ctx) {
    const resolved = await resolveContent(input, ctx);
    if (resolved.type !== "text") throw new Error("AICore.translate: only text content is supported");

    const result = await complete(
        `You translate text into ${targetLang}. Respond with ONLY the translated text, no commentary.`,
        resolved.text,
        ctx?.meta?.user || {}
    );

    return { text: result.message };
}

async function generate(prompt, params = {}, ctx) {
    const result = await complete(
        params.systemPrompt || "You are a helpful writing assistant.",
        prompt,
        ctx?.meta?.user || {},
        params
    );
    return { text: result.message };
}

async function moderate(input, ctx) {
    const resolved = await resolveContent(input, ctx);
    if (resolved.type !== "text") throw new Error("AICore.moderate: only text content is supported");

    const instruction =
        "Assess whether the following content violates common content policy (hate, harassment, " +
        "sexual content involving minors, violent extremism, self-harm promotion, illegal activity). " +
        'Respond with ONLY JSON: {"flagged": true|false, "categories": ["..."], "reason": "..."}.';

    const result = await complete(
        "You are a content moderation classifier.",
        [{ type: "text", text: instruction }, { type: "text", text: resolved.text }],
        ctx?.meta?.user || {}
    );

    return safeParseJSON(result.message) || { flagged: false, categories: [], reason: "unparseable response" };
}

async function describe(attachment, ctx) {
    const resolved = await resolveContent(attachment, ctx);
    if (resolved.type !== "image") throw new Error("AICore.describe: input must resolve to an image");

    const result = await complete(
        "You describe images accurately and concisely for someone who cannot see them.",
        [{ type: "text", text: "Describe this image." }, resolved],
        ctx?.meta?.user || {}
    );

    return { description: result.message };
}

async function ocr(attachment, ctx) {
    const resolved = await resolveContent(attachment, ctx);
    if (resolved.type !== "image") throw new Error("AICore.ocr: input must resolve to an image");

    const result = await complete(
        "You transcribe all visible text in an image exactly as it appears, with no commentary.",
        [{ type: "text", text: "Transcribe all text visible in this image." }, resolved],
        ctx?.meta?.user || {}
    );

    return { text: result.message };
}

//queryNL(question, dbkey, ctx) - natural language -> the real agent loop,
//restricted to the Logiks JSON-query-DSL MCP tools (query_schema/query_index/
//query_results/query_analyse - see api/controllers/mcp/tools/), so the model
//never sees or sends raw SQL. Uses a fixed, transient persona/agent instead
//of a DB-backed one, since this capability isn't user-defined data. Not
//persisted to conversation history - each call is independent.
async function queryNL(question, dbkey = "appdb", ctx) {
    const persona = {
        system_prompt:
            `You answer questions about data in the '${dbkey}' database using the available query tools. ` +
            `Call query_schema first if you don't already know the relevant table/column names, then use ` +
            `query_results to fetch real data before answering. Never fabricate numbers - if the tools can't ` +
            `answer the question, say so.`,
        model: null,
        allowed_tools: ["query_schema", "query_index", "query_results", "query_analyse"],
        params: {}
    };
    const agent = { max_steps: 6, timeout_ms: 30000 };

    const result = await AGENT_LOOP.executeLoop(ENGINES, RESILIENCE_CONFIG, UNIQUEID.generate(10), persona, agent, question, ctx, { persist: false });

    const toolResults = result.turnMessages
        .filter(m => m.role === "tool" && m.name === "query_results")
        .map(m => safeParseJSON(m.content));

    return {
        answer: result.message,
        data: toolResults.length ? toolResults[toolResults.length - 1] : null,
        status: result.status
    };
}

//embed(input, ctx) - tries configured engines in priority order, skipping
//any that don't implement embed() (the aiengine.js default throws). Only
//openai.js has a real implementation today.
async function embed(input, ctx, params = {}) {
    let lastErr;
    for (const engine of ENGINES) {
        try {
            const vectors = await engine.instance.embed(input, params);
            return { vectors, engineKey: engine.key };
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error("AICore: no configured engine supports embeddings");
}

function safeParseJSON(text) {
    if (!text) return null;
    const cleaned = String(text).trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "");
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

module.exports = {
    configure,
    summerize,
    extract,
    classify,
    translate,
    generate,
    moderate,
    describe,
    ocr,
    queryNL,
    embed
};
