//Logiks Tooling System - client for the tooling server (a FastAPI service
//that runs document/AI tools: text extraction, OCR, embeddings, PDF work).
//
//Config (CONFIG.aicore.tooling):
//  { enabled, url, token?, publicBaseUrl?, timeoutMs, extractTimeoutMs,
//    extractTool, linkTtlSeconds, allowPrivateUrls }
//
//  token            sent as a Bearer header when set; the server we tested
//                   against did not ask for one.
//  publicBaseUrl    origin the tooling server can reach this AppServer on,
//                   when CONFIG.base_url isn't it (e.g. base_url is localhost).
//  extractTool      which server tool does text extraction (default unstructured_tool).
//  allowPrivateUrls let extract() hand the server URLs that point at private
//                   addresses; off by default so a tenant can't aim the
//                   tooling server at internal services.
//
//Protocol, as observed on the server:
//  GET  /list_tools    -> { tools: [{ name, description, inputSchema }] }
//  POST /run           -> body { command: "run", tool, ...toolParams } (flat -
//                         the tool's parameters sit beside `tool`, not under a
//                         wrapper). Answer is { response: { status, ... } } or
//                         a bare { status, message }. A tool failure is still
//                         HTTP 200 with status:"error"; a missing `tool` is a 500.
//  POST /initiate_run  -> same body; answers { status:"processing", reference_id }
//  GET  /get_result?reference_id=...
//
//Tools take their file as a URL (`url`, or `file_path` for some) that the
//tooling server downloads itself, and the server is usually on another
//machine, so extract() publishes the file as a short-lived /api/public/files
//link, uses it, and retires it afterwards.

const RESILIENCE = require("./aicore/resilience.js");

const TOOLS_CACHE_KEY = "aicore:tooling:tools";
const TOOLS_CACHE_TTL = 300;

const DEFAULTS = {
    timeoutMs: 60000,
    extractTimeoutMs: 300000,
    extractTool: "unstructured_tool",
    linkTtlSeconds: 1800
};

var settings = null;

module.exports = {

    //Not cluster-public (no `return true`): extract() publishes files for the
    //guid it is given, so it must not be reachable through system.controllers.
    initialize: function() {
        const cfg = CONFIG.aicore?.tooling;
        if (!(CONFIG.aicore?.enabled && cfg?.enabled && cfg.url)) {
            settings = null;
            return false;
        }

        settings = _.extend({}, DEFAULTS, cfg, { url: String(cfg.url).replace(/\/+$/, "") });
        console.log("\x1b[36m%s\x1b[0m", `AICore Tooling server: ${settings.url}`);
        return false;
    },

    isEnabled: function() {
        return !!conf();
    },

    //[{ name, description, inputSchema }] - cached briefly, since it rarely changes.
    listTools: async function(guid, refresh = false) {
        if (!refresh) {
            const cached = await _CACHE.fetchDataSync(TOOLS_CACHE_KEY, null);
            if (cached) return cached;
        }

        const body = await request("GET", "/list_tools", null, {});
        const tools = (body.tools || []).map(t => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || {} }));

        await _CACHE.storeDataEx(TOOLS_CACHE_KEY, tools, TOOLS_CACHE_TTL);
        return tools;
    },

    //Runs a tool and returns the tool's own result object (the inside of
    //`response`), e.g. { status:"success", data:{ extracted_text } }.
    //Throws when the tool reports an error. params are the tool's parameters.
    //opts: { timeoutMs, maxAttempts }
    execute: async function(guid, tool, params = {}, opts = {}) {
        if (!tool) throw new Error("TOOLING.execute: tool is required");

        const body = await request("POST", "/run", _.extend({}, params, { command: "run", tool }), opts);
        return unwrap(body, tool);
    },

    //Plain text of a file. source: a files_tbl id, a path_uri under the upload
    //root, or an http(s) URL. A stored file is published as a temporary public
    //link (valid linkTtlSeconds, retired as soon as the call returns).
    //Resolves "" when the file has no text; throws when the tool fails.
    //ctx is optional and only used for audit fields on the temporary link.
    extract: async function(guid, source, ctx, opts = {}) {
        const cfg = need();
        const link = await toFetchableUrl(guid, source, ctx, cfg);

        try {
            const result = await module.exports.execute(guid, opts.tool || cfg.extractTool, { url: link.url }, { timeoutMs: cfg.extractTimeoutMs, maxAttempts: 1 });
            return textOf(result);
        } finally {
            if (link.retire) await link.retire();
        }
    },

    //input: a string or an array of strings. Returns { embeddings: [[...]], dimension, model }.
    embed: async function(guid, input, opts = {}) {
        const params = Array.isArray(input) ? { texts: input } : { text: String(input) };
        if (opts.model) params.model = opts.model;

        const result = await module.exports.execute(guid, "embedding", params);
        return { embeddings: result.embeddings || [], dimension: result.dimension, model: result.model };
    },

    //Starts a run on the server's async lane and returns its reference id.
    //Pair with result(). On the server we tested, a reference stayed
    //"processing" and never completed, so extract() uses the synchronous /run
    //instead; this is here for when that lane is working.
    start: async function(guid, tool, params = {}) {
        const body = await request("POST", "/initiate_run", _.extend({}, params, { command: "run", tool }), {});
        return { referenceId: body.reference_id, status: body.status };
    },

    result: async function(guid, referenceId) {
        return await request("GET", "/get_result?reference_id=" + encodeURIComponent(referenceId), null, {});
    },

    //Never throws - says whether the server answered.
    health: async function(guid) {
        const cfg = conf();
        if (!cfg) return { ok: false, error: "Tooling server is not configured" };

        const started = Date.now();
        try {
            const body = await request("GET", "/list_tools", null, { timeoutMs: 5000, maxAttempts: 1 });
            return { ok: true, ms: Date.now() - started, tools: (body.tools || []).length };
        } catch (err) {
            return { ok: false, ms: Date.now() - started, error: err.message };
        }
    }
};

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

function conf() {
    //initialize() normally runs at boot; this covers a config change under test or a late-enabled server
    if (!settings && CONFIG.aicore?.enabled && CONFIG.aicore?.tooling?.enabled && CONFIG.aicore.tooling.url) {
        settings = _.extend({}, DEFAULTS, CONFIG.aicore.tooling, { url: String(CONFIG.aicore.tooling.url).replace(/\/+$/, "") });
    }
    return settings;
}

function need() {
    const cfg = conf();
    if (!cfg) throw new Error("TOOLING: tooling server is not configured (CONFIG.aicore.tooling)");
    return cfg;
}

//One HTTP call with retry and a breaker for the server. Network failures and
//5xx count against the breaker; a 4xx (a rejected request) does not.
async function request(method, path, data, { timeoutMs, maxAttempts } = {}) {
    const cfg = need();
    const timeout = timeoutMs || cfg.timeoutMs;
    const retry = _.extend({}, CONFIG.aicore?.retry, { timeoutMs: timeout });
    if (maxAttempts) retry.maxAttempts = maxAttempts;

    return await RESILIENCE.guarded("tooling:" + cfg.url, async () => {
        try {
            const response = await axios({
                url: cfg.url + path,
                method,
                headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
                data: data || undefined,
                timeout
            });
            return response.data || {};
        } catch (err) {
            const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
            const error = new Error(`Tooling server request failed: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
            error.cause = err;
            error.status = err.response?.status;
            throw error;
        }
    }, retry, CONFIG.aicore?.breaker || {});
}

//The server wraps most answers in { response }, and a few tools answer bare.
function unwrap(body, tool) {
    const result = body && body.response !== undefined ? body.response : body;

    if (!result || typeof result !== "object") {
        const error = new Error(`Tooling tool '${tool}' returned no result`);
        error.status = 422;
        throw error;
    }
    if (result.status === "error") {
        //The server answered, so this is the request's problem, not the server's health (422 skips retry and breaker)
        const error = new Error(`Tooling tool '${tool}' failed: ${result.message || "unknown error"}`);
        error.status = 422;
        throw error;
    }
    return result;
}

//Extraction tools answer in a few shapes: { data:{ extracted_text } }, or
//{ data:[{ content, page_number, ... }] } for the page-wise ones.
function textOf(result) {
    const data = result.data;
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return data.map(chunk => chunk.content || chunk.text || "").filter(Boolean).join("\n\n");
    if (data && typeof data === "object") return data.extracted_text ?? data.text ?? data.content ?? "";
    return result.extracted_text ?? result.text ?? "";
}

//Gives the tooling server something it can download. Returns { url, retire? }.
async function toFetchableUrl(guid, source, ctx, cfg) {
    if (source == null || source === "") throw new Error("TOOLING.extract: a file id, path or URL is required");
    const text = String(source).trim();

    if (/^https?:\/\//i.test(text)) {
        if (!cfg.allowPrivateUrls && isPrivateHost(new URL(text).hostname)) {
            throw new Error("TOOLING.extract: URLs that point at private or local addresses are not allowed");
        }
        return { url: text };
    }

    const fileId = /^\d+$/.test(text) ? Number(text) : await fileIdForPath(guid, text);
    if (!fileId) throw new Error(`TOOLING.extract: no file found for '${text}'`);

    const expires = moment().add(cfg.linkTtlSeconds, "seconds").format("YYYY-MM-DD HH:mm:ss");
    const published = await FILES.publishFile(guid, fileId, expires, ctx || { meta: { user: { userId: "aicore" } } });
    if (!published) throw new Error(`TOOLING.extract: file '${text}' could not be published`);

    const link = new URL(published);
    const uri = link.pathname.split("/").pop();

    //Hand over the origin the tooling server can actually reach
    if (cfg.publicBaseUrl) {
        const base = new URL(cfg.publicBaseUrl);
        link.protocol = base.protocol;
        link.host = base.host;
    }

    return {
        url: link.toString(),
        retire: async () => {
            try {
                await _DB.db_updateQ("appdb", "files_published", { blocked: "true" }, { guid, uri });
            } catch (err) {
                //The link still expires on its own; failing to retire it early isn't worth failing the extract
                console.error(`TOOLING: could not retire temporary link ${uri} - ${err.message}`);
            }
        }
    };
}

async function fileIdForPath(guid, pathUri) {
    const result = await _DB.db_selectQ("appdb", "files_tbl", "id", { guid, path_uri: pathUri, blocked: "false" }, {});
    return result?.results?.[0]?.id || null;
}

//Literal checks only (hostnames aren't resolved) - enough to stop the obvious
//http://127.0.0.1/ or http://192.168.x.x/ forms.
function isPrivateHost(hostname) {
    const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;

    const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:");
}
