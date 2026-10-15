//Knowledge layer for AICore - retrieval and ingestion against Vector-Gateway
//servers (znotes/vector_gateway_openapi.json, the /vdb surface).
//
//Each row of sys_ai_knowledge (appdb) is one knowledge base: a gateway
//server plus the dbId / tenantId / namespace on it. A persona's
//allowed_knowledge lists knowledge_codes, so several bases on several
//servers can back one persona. aicore/rag.js is the only caller of search().
//
//data_index (JSON column) is a small running summary of the base, never the
//documents themselves - the gateway holds those, and a base may hold
//millions. It only carries counters and timestamps:
//
//  docCount       documents at the last sync() - the gateway's own total
//  exact          false when the gateway said the total was truncated
//  ingestedSince  documents accepted since that sync
//  removedSince   documents deleted since that sync
//  lastIngestAt / lastDeleteAt / lastSyncAt
//  lastError / lastErrorAt   most recent gateway failure (cleared on success)
//
//search() uses it to skip bases that are known to be empty. Ingest and
//delete only move the "since" counters, because the gateway doesn't tell us
//whether an ingested docId was new or a replacement - sync() is what makes
//the numbers exact again.
//
//Sources the stub header once listed besides the gateway (MySQL full-text,
//local RAG) are not implemented.

const RESILIENCE = require("./aicore/resilience.js");

const TABLE = "sys_ai_knowledge";
const CACHE_PREFIX = "aicore:knowledge:";
const CACHE_TTL = 60; //short: data_index changes on other nodes must show up quickly
const DEFAULT_TOP_N = 5;
const SEARCH_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 30000;
const ERROR_WRITE_INTERVAL_MS = 60000;

//Throttle for lastError writes, so a down server doesn't turn every search into a DB write
const errorWrittenAt = new Map();

module.exports = {

    //Deliberately not cluster-public (no `return true`): every method takes a
    //guid from its caller, so exposing them through system.controllers would
    //let another node read any tenant's knowledge.
    initialize: function() {
        return false;
    },

    // -----------------------------------------------------------------
    // Knowledge base registry (sys_ai_knowledge)
    // -----------------------------------------------------------------

    //Reads hide the bearer key (has_key tells you whether one is set).
    list: async function(guid) {
        const result = await _DB.db_selectQ("appdb", TABLE, "*", { guid, blocked: "false" }, {});
        return (result?.results || []).map(parseRecord).map(publicView);
    },

    get: async function(guid, knowledgeCode) {
        const row = await resolve(guid, knowledgeCode);
        return row ? publicView(row) : null;
    },

    //data_index is never written from here - it belongs to the ingest/sync paths.
    upsert: async function(guid, knowledgeCode, data, ctx) {
        const existing = await resolve(guid, knowledgeCode, false);

        const record = {
            guid,
            knowledge_code: knowledgeCode,
            title: data.title || knowledgeCode,
            server_url: data.serverUrl,
            authorization_key: data.authorizationKey != null ? data.authorizationKey : (existing?.authorization_key || ""),
            db_id: data.dbId,
            tenant_id: data.tenantId || "",
            namespace: data.namespace,
            //chunk_size, chunk_overlap, rerank, timeoutMs - see chunkOptions() / searchOne()
            params: JSON.stringify(data.params || {}),
            blocked: "false"
        };

        for (const field of ["server_url", "db_id", "namespace"]) {
            if (!record[field]) throw new Error(`KNOWLEDGE.upsert: '${field}' is required`);
        }
        //The bearer key is sent to this URL, so it has to be a plain http(s) address
        if (!/^https?:\/\/[^\s/]+/i.test(record.server_url)) throw new Error("KNOWLEDGE.upsert: 'server_url' must be an http(s) URL");

        if (existing) {
            await _DB.db_updateQ("appdb", TABLE, _.extend(record, MISC.generateDefaultDBRecord(ctx, true)), { guid, knowledge_code: knowledgeCode });
        } else {
            await _DB.db_insertQ1("appdb", TABLE, _.extend(record, MISC.generateDefaultDBRecord(ctx, false)));
        }

        await _CACHE.deleteKey(CACHE_PREFIX + guid + ":" + knowledgeCode);
        return publicView(await resolve(guid, knowledgeCode));
    },

    remove: async function(guid, knowledgeCode, ctx) {
        await _DB.db_updateQ("appdb", TABLE, _.extend({ blocked: "true" }, MISC.generateDefaultDBRecord(ctx, true)), { guid, knowledge_code: knowledgeCode });
        await _CACHE.deleteKey(CACHE_PREFIX + guid + ":" + knowledgeCode);
        return true;
    },

    // -----------------------------------------------------------------
    // Retrieval
    // -----------------------------------------------------------------

    //rag.js call: filter.scopes = the persona's allowed_knowledge (knowledge_codes).
    //Every base is queried in parallel; one that is down, empty or unknown is
    //skipped, so a bad base never fails the turn. `cypher` is unused.
    //params.strict = true is for debugging: a failed base throws instead of
    //being skipped. Returns [{ text, score, docId, knowledge, payload }] best-first.
    search: async function(guid, stext, cypher = false, filter = {}, params = {}, top_n = DEFAULT_TOP_N) {
        const codes = _.uniq(filter?.scopes || []);
        if (!stext || codes.length === 0) return [];

        const rows = (await Promise.all(codes.map(code => resolve(guid, code)))).filter(Boolean);
        const searchable = rows.filter(row => !isKnownEmpty(row.data_index));

        const outcomes = await Promise.allSettled(searchable.map(row => searchOne(row, stext, top_n, params)));

        const hits = [];
        const failures = [];
        outcomes.forEach((outcome, i) => {
            if (outcome.status === "fulfilled") {
                hits.push(...outcome.value);
            } else {
                const row = searchable[i];
                console.error(`KNOWLEDGE: search on '${row.knowledge_code}' failed - ${outcome.reason?.message}`);
                recordError(row, outcome.reason);
                failures.push(outcome.reason);
            }
        });

        if (params.strict && failures.length > 0) throw failures[0];

        return rankHits(hits, top_n);
    },

    // -----------------------------------------------------------------
    // Ingestion
    // -----------------------------------------------------------------

    //Queues one document (the gateway chunks and embeds it asynchronously).
    //replace (default true) drops the docId's existing chunks first, so
    //re-ingesting an edited document doesn't leave stale chunks behind.
    ingest: async function(guid, knowledgeCode, docId, text, payload = {}, opts = {}) {
        if (!docId || !text) throw new Error("KNOWLEDGE.ingest: docId and text are required");
        const row = await need(guid, knowledgeCode);

        const data = await gateway(row, "POST", "/vdb/ingest", _.extend(chunkOptions(row, opts), {
            docId: String(docId),
            text,
            payload,
            replace: opts.replace !== false,
            bypass_hashcheck: !!opts.bypassHashcheck
        }), { timeoutMs: WRITE_TIMEOUT_MS });

        await touchIndex(row, idx => bump(idx, "ingestedSince", 1, { lastIngestAt: now() }));
        return data;
    },

    //documents: [{ docId, text, payload? }]. The gateway's batch call has no
    //replace flag, and it isn't retried - a retry would queue every document twice.
    ingestBatch: async function(guid, knowledgeCode, documents, opts = {}) {
        if (!Array.isArray(documents) || documents.length === 0) throw new Error("KNOWLEDGE.ingestBatch: documents[] is required");
        const row = await need(guid, knowledgeCode);

        const data = await gateway(row, "POST", "/vdb/ingest/batch", _.extend(chunkOptions(row, opts), {
            documents: documents.map(d => ({ docId: String(d.docId), text: d.text, payload: d.payload || {} }))
        }), { timeoutMs: WRITE_TIMEOUT_MS, maxAttempts: 1 });

        await touchIndex(row, idx => bump(idx, "ingestedSince", data.accepted ?? documents.length, { lastIngestAt: now() }));
        return data;
    },

    //docIds: one id or an array.
    removeDocuments: async function(guid, knowledgeCode, docIds) {
        const ids = [].concat(docIds).filter(Boolean).map(String);
        if (ids.length === 0) throw new Error("KNOWLEDGE.removeDocuments: at least one docId is required");
        const row = await need(guid, knowledgeCode);

        const data = await gateway(row, "POST", "/vdb/delete", ids.length === 1 ? { docId: ids[0] } : { docIds: ids }, { timeoutMs: WRITE_TIMEOUT_MS });

        await touchIndex(row, idx => bump(idx, "removedSince", ids.length, { lastDeleteAt: now() }));
        return data;
    },

    //Documents in the base, grouped by docId with chunk counts. Cursor-paged:
    //pass back nextCursor. Meant for browsing, not for counting - use sync().
    listDocuments: async function(guid, knowledgeCode, opts = {}) {
        const row = await need(guid, knowledgeCode);
        return await gateway(row, "POST", "/vdb/documents/list", _.pickBy({ limit: opts.limit, cursor: opts.cursor, filter: opts.filter }, v => v != null));
    },

    //One document's chunks. Returns { found: false } instead of throwing for an unknown docId.
    getDocument: async function(guid, knowledgeCode, docId, opts = {}) {
        const row = await need(guid, knowledgeCode);
        try {
            return await gateway(row, "POST", "/vdb/documents/list/" + encodeURIComponent(docId), _.pickBy({ limit: opts.limit, cursor: opts.cursor }, v => v != null));
        } catch (err) {
            if (err.status === 404) return { found: false, docId };
            throw err;
        }
    },

    //Refreshes data_index from the gateway's own total. Asks for a page of one
    //- only the total is wanted, so this stays cheap on a very large base.
    sync: async function(guid, knowledgeCode) {
        const row = await need(guid, knowledgeCode);
        const data = await gateway(row, "POST", "/vdb/documents/list", { limit: 1 });

        const index = await touchIndex(row, idx => {
            idx.docCount = data.total ?? 0;
            idx.exact = !data.truncated;
            idx.ingestedSince = 0;
            idx.removedSince = 0;
            idx.lastSyncAt = now();
            if (idx.docCount === 0) idx.lastIngestAt = null;
        });
        return index;
    },

    //Never throws - the result says whether the server answered.
    health: async function(guid, knowledgeCode) {
        const row = await need(guid, knowledgeCode);
        const started = Date.now();
        try {
            const response = await axios({ url: baseUrl(row) + "/health", method: "GET", timeout: 5000 });
            return { ok: true, status: response.data?.status || "ok", ms: Date.now() - started, details: response.data };
        } catch (err) {
            return { ok: false, status: err.response?.status || null, ms: Date.now() - started, error: err.message };
        }
    },

    //filePath = id of files_tbl, a path_uri under the upload root, or an http(s) URL.
    //Text extraction is the tooling server's job (api/controllers/tooling.js).
    //Returns the text, or null when the file has none; throws if the tooling
    //server is not configured or the extraction fails.
    extract: async function(guid, filePath, ctx) {
        const text = await TOOLING.extract(guid, filePath, ctx);
        return text && text.trim() ? text : null;
    }
};

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

//Full record including the bearer key - internal use only, public reads go through publicView().
async function resolve(guid, knowledgeCode, useCache = true) {
    if (!guid || !knowledgeCode) return null;

    const cacheKey = CACHE_PREFIX + guid + ":" + knowledgeCode;
    if (useCache) {
        const cached = await _CACHE.fetchDataSync(cacheKey, null);
        if (cached) return cached;
    }

    const result = await _DB.db_selectQ("appdb", TABLE, "*", { guid, knowledge_code: knowledgeCode, blocked: "false" }, {});
    const row = result?.results?.[0] ? parseRecord(result.results[0]) : null;

    if (row && useCache) await _CACHE.storeDataEx(cacheKey, row, CACHE_TTL);
    return row;
}

async function need(guid, knowledgeCode) {
    const row = await resolve(guid, knowledgeCode);
    if (!row) throw new Error(`KNOWLEDGE: knowledge base '${knowledgeCode}' not found`);
    return row;
}

function parseRecord(row) {
    return _.extend({}, row, { params: parseJSON(row.params), data_index: parseJSON(row.data_index) });
}

function parseJSON(value) {
    if (value && typeof value === "object") return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function publicView(row) {
    return _.extend(_.omit(row, "authorization_key"), { has_key: !!row.authorization_key });
}

function baseUrl(row) {
    return String(row.server_url || "").replace(/\/+$/, "");
}

function now() {
    return new Date().toISOString();
}

//Only skip a base once a sync has shown it empty and nothing has been ingested since.
function isKnownEmpty(idx) {
    return !!idx.lastSyncAt && idx.docCount === 0 && idx.exact !== false && !idx.ingestedSince;
}

function chunkOptions(row, opts) {
    const size = opts.chunkSize || row.params.chunk_size;
    const overlap = opts.chunkOverlap || row.params.chunk_overlap;
    //"chunk_ovarlap" is how the gateway spells it
    return _.pickBy({ chunk_size: size, chunk_ovarlap: overlap }, v => v != null);
}

//One gateway call, with retry and a breaker per server. A 200 carrying
//status:"error" (the gateway's validation failure) is thrown as a 422, which
//neither retries nor counts against the server's breaker.
async function gateway(row, method, path, body, { timeoutMs = SEARCH_TIMEOUT_MS, maxAttempts } = {}) {
    const timeout = row.params.timeoutMs || timeoutMs;
    const retry = _.extend({}, CONFIG.aicore?.retry, { timeoutMs: timeout });
    if (maxAttempts) retry.maxAttempts = maxAttempts;

    const payload = _.extend({ dbId: row.db_id, tenantId: row.tenant_id || row.guid, namespace: row.namespace }, body);

    return await RESILIENCE.guarded("knowledge:" + baseUrl(row), async () => {
        let response;
        try {
            response = await axios({
                url: baseUrl(row) + path,
                method,
                headers: row.authorization_key ? { Authorization: `Bearer ${row.authorization_key}` } : {},
                data: payload,
                timeout
            });
        } catch (err) {
            const detail = err.response?.data?.msg || err.response?.data?.message || err.response?.data?.error || err.message;
            const error = new Error(`Vector-Gateway request failed: ${detail}`);
            error.cause = err;
            error.status = err.response?.status;
            throw error;
        }

        const data = response.data || {};
        if (data.status === "error") {
            const error = new Error(`Vector-Gateway rejected the request: ${data.msg || data.message || "error"}${data.errors ? " " + JSON.stringify(data.errors) : ""}`);
            error.status = 422;
            throw error;
        }
        return data;
    }, retry, CONFIG.aicore?.breaker || {});
}

async function searchOne(row, query, topN, params) {
    const filter = params.filter || row.params.filter;
    const body = {
        query,
        limit: topN,
        rerank: params.rerank ?? row.params.rerank ?? true
    };
    if (filter) body.filter = filter;

    const data = await gateway(row, "POST", "/vdb/search", body);

    if (row.data_index.lastError) recordRecovery(row);
    return (data.results || []).map(r => normalizeHit(r, row.knowledge_code));
}

//The gateway documents `results` as free-form objects, so accept the likely
//spellings rather than assuming one.
function normalizeHit(r, knowledgeCode) {
    if (typeof r === "string") return { text: r, score: null, docId: null, knowledge: knowledgeCode, payload: {} };

    const payload = r.payload || r.metadata || {};
    const score = [r.score, r.rerank_score, r.rerankScore, r.similarity, r.relevance].find(v => typeof v === "number");

    return {
        text: r.text ?? r.content ?? r.chunk ?? payload.text ?? "",
        score: score ?? null,
        docId: r.docId ?? r.doc_id ?? payload.docId ?? payload.doc_id ?? null,
        chunkIndex: r.chunk_index ?? payload.chunk_index ?? null,
        knowledge: knowledgeCode,
        payload
    };
}

//Scores from different servers (and rerankers) aren't strictly comparable, but
//best-score-first is the least surprising merge; unscored hits sort last.
function rankHits(hits, topN) {
    const seen = new Set();
    const unique = hits.filter(h => {
        const key = h.docId != null && h.chunkIndex != null ? `${h.knowledge}|${h.docId}|${h.chunkIndex}` : `${h.knowledge}|${h.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    unique.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    return unique.slice(0, topN);
}

// ---------------------------------------------------------------------
// data_index maintenance
// ---------------------------------------------------------------------

function bump(idx, field, by, extra = {}) {
    idx[field] = Math.max(0, (idx[field] || 0) + by);
    _.extend(idx, extra);
}

//Read-modify-write against the database, not the cache, so a stale cached row
//can't overwrite newer counters. Concurrent writers can still lose an update;
//the counters are advisory and sync() restores them. Never throws - index
//bookkeeping must not fail an ingest that already succeeded.
async function touchIndex(row, mutate) {
    try {
        const result = await _DB.db_selectQ("appdb", TABLE, "id,data_index", { guid: row.guid, knowledge_code: row.knowledge_code, blocked: "false" }, {});
        const current = result?.results?.[0];
        if (!current) return null;

        const idx = parseJSON(current.data_index);
        mutate(idx);

        await _DB.db_updateQ("appdb", TABLE, { data_index: JSON.stringify(idx) }, { guid: row.guid, knowledge_code: row.knowledge_code });
        await _CACHE.deleteKey(CACHE_PREFIX + row.guid + ":" + row.knowledge_code);
        return idx;
    } catch (err) {
        console.error(`KNOWLEDGE: could not update data_index for '${row.knowledge_code}' - ${err.message}`);
        return null;
    }
}

function recordError(row, err) {
    const key = row.guid + ":" + row.knowledge_code;
    const last = errorWrittenAt.get(key) || 0;
    if (Date.now() - last < ERROR_WRITE_INTERVAL_MS) return;
    errorWrittenAt.set(key, Date.now());

    touchIndex(row, idx => {
        idx.lastError = String(err?.message || err).slice(0, 300);
        idx.lastErrorAt = now();
    });
}

function recordRecovery(row) {
    errorWrittenAt.delete(row.guid + ":" + row.knowledge_code);
    touchIndex(row, idx => {
        idx.lastError = null;
        idx.lastErrorAt = null;
    });
}
