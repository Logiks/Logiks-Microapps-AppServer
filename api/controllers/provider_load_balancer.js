/*
 * Provider Load Balancer
 * Picks which provider (sys_providers row) serves a request when several providers share the same
 * provider_engine, whatever the engine is (AI models, analytics, reporting, sysops, etc).
 *
 * Used by PROVIDERS.sendLB(guid, providerEngine, ...). PROVIDERS.send(guid, providerCode, ...) bypasses
 * this entirely and talks to the named provider directly.
 *
 * Policies (optionParams.policy, else CONFIG.PROVIDER_LOAD_BALANCER.policy, else round_robin):
 *   round_robin   - rotate through the providers in a stable order
 *   weighted      - round robin, but a provider appears `weight` times per cycle
 *   least_loaded  - fewest in-flight requests right now (counted per node)
 *   least_used    - fewest requests served in the current usage window (shared across nodes)
 *   latency       - lowest moving-average latency, untested providers are tried first
 *   random        - uniform random pick
 *
 * Per-provider settings live in the JSON of sys_providers.params:
 *   { "weight": 3, "max_concurrent": 10 }
 *
 * A provider whose circuit breaker is open is skipped. If the chosen provider fails, the request is
 * switched to the next candidate in policy order, once (config.maxFailovers, default 1). Request-level
 * errors (400/404/413/422) are not switched since another provider would reject the same request.
 *
 * A switch re-sends the request, so it only happens when that cannot run an action twice:
 *   - options.idempotent is true (PROVIDERS.sendLB sets it for GET/HEAD/OPTIONS, or from optionParams.idempotent), or
 *   - the failure proves the provider never took the request: connection refused / DNS failure / unreachable,
 *     HTTP 429 or 503.
 * Anything else (a timeout, a 500, a dropped connection mid-request) may have been processed, so it is raised
 * to the caller instead of being sent to a second provider.
 *
 * In-flight requests are tracked as one entry per request with its own deadline, so a node that crashes
 * mid-request stops counting toward a provider's load once that deadline passes, with no manual cleanup.
 *
 * All state (cursor, in-flight, usage, latency, breaker) lives in Redis so every node in the cluster
 * balances against the same numbers. Counters use atomic INCR/DECR. If Redis is not ready or errors,
 * that node falls back to its own in-process state instead of failing the request.
 */

const crypto = require("crypto");

const PREFIX = "providerlb:";
const POLICIES = ["round_robin", "weighted", "least_loaded", "least_used", "latency", "random"];
const DEFAULTS = {
    policy: "round_robin",
    usageWindowSec: 3600,
    breaker: { failureThreshold: 3, cooldownMs: 30000 },
    latencyAlpha: 0.3,
    maxFailovers: 1,
};
const INFLIGHT_DEADLINE_MS = 60000; //an in-flight entry older than this is treated as dead (crashed node)
const SAFE_NETWORK_CODES = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"];
const SAFE_STATUS = [429, 503];

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m", "Provider Load Balancer Initialized");
        return false;
    },

    getPolicies: function() {
        return [...POLICIES];
    },

    /*
     * providers: rows from sys_providers (all for the same provider_engine)
     * callFn:    async (provider) => result, performs the actual request
     * options:   { policy, scope, usageWindowSec, breaker }
     */
    dispatch: async function(providers, callFn, options = {}) {
        const config = { ...DEFAULTS, ...(CONFIG.PROVIDER_LOAD_BALANCER || {}), ...stripUndefined(options) };
        if(!POLICIES.includes(config.policy)) {
            throw new Error("Unsupported load balancer policy: " + config.policy);
        }
        if(!providers || providers.length <= 0) {
            throw new Error("No providers available for load balancing");
        }

        const scope = config.scope || providers[0].provider_engine || "default";
        const ordered = await this.order(providers, config.policy, scope, config);
        if(ordered.length <= 0) {
            throw new Error("No healthy providers available for engine: " + scope);
        }

        const maxFailovers = Math.max(0, parseInt(config.maxFailovers) || 0);
        const attempts = ordered.slice(0, 1 + maxFailovers);

        let lastErr;
        for(const provider of attempts) {
            const code = provider.provider_code;
            const started = Date.now();
            const requestId = await state.startInflight(code, config.inflightDeadlineMs || INFLIGHT_DEADLINE_MS);
            try {
                const result = await callFn(provider);
                await recordSuccess(code, Date.now() - started, config);
                return result;
            } catch(err) {
                lastErr = err;
                console.error(`PROVIDER_LOAD_BALANCER: provider '${code}' failed`, err.message);
                if(isRequestError(err)) throw err;
                await recordFailure(code, config);
                if(!config.idempotent && !isSafeToResend(err)) {
                    console.error(`PROVIDER_LOAD_BALANCER: not switching provider, '${code}' may have processed the request`);
                    throw err;
                }
            } finally {
                await state.endInflight(code, requestId);
            }
        }
        throw lastErr;
    },

    //Returns the usable providers in the order they should be attempted
    order: async function(providers, policy, scope, config = DEFAULTS) {
        const stable = [...providers].sort((a, b) => String(a.provider_code).localeCompare(String(b.provider_code)));

        const healthy = [];
        for(const p of stable) {
            if(await isBreakerOpen(p.provider_code)) continue;
            if(await isSaturated(p)) continue;
            healthy.push(p);
        }
        if(healthy.length <= 1) return healthy;

        switch(policy) {
            case "round_robin":
                return rotate(healthy, await nextCursor(scope));

            case "weighted": {
                const slots = [];
                healthy.forEach(p => { for(let i = 0; i < weightOf(p); i++) slots.push(p); });
                const start = slots[(await nextCursor(scope)) % slots.length];
                return rotate(healthy, healthy.indexOf(start));
            }

            case "least_loaded": {
                const load = {};
                for(const p of healthy) load[p.provider_code] = await state.getInflight(p.provider_code);
                return sortBy(healthy, p => load[p.provider_code] / weightOf(p));
            }

            case "least_used": {
                const usage = {};
                for(const p of healthy) usage[p.provider_code] = await getUsage(p.provider_code);
                return sortBy(healthy, p => usage[p.provider_code] / weightOf(p));
            }

            case "latency": {
                const lat = {};
                for(const p of healthy) lat[p.provider_code] = (await getStats(p.provider_code)).latency;
                //null latency (never measured) sorts first so every provider gets sampled
                return sortBy(healthy, p => lat[p.provider_code] == null ? -1 : lat[p.provider_code]);
            }

            case "random":
                return shuffle(healthy);
        }
        return healthy;
    },

    //Providers' live view, for dashboards and debugging
    stats: async function(providers) {
        const out = [];
        for(const p of providers) {
            const stats = await getStats(p.provider_code);
            out.push({
                provider_code: p.provider_code,
                inflight: await state.getInflight(p.provider_code),
                usage: await getUsage(p.provider_code),
                latency: stats.latency,
                breaker_open: await isBreakerOpen(p.provider_code),
            });
        }
        return out;
    }
};

function providerParams(p) {
    if(p._parsedParams) return p._parsedParams;
    let params = {};
    try {
        params = typeof p.params === "string" ? JSON.parse(p.params || "{}") : (p.params || {});
    } catch(e) {}
    Object.defineProperty(p, "_parsedParams", { value: params, enumerable: false });
    return params;
}

function weightOf(p) {
    const w = parseInt(providerParams(p).weight);
    return w > 0 ? w : 1;
}

async function isSaturated(p) {
    const max = parseInt(providerParams(p).max_concurrent);
    return max > 0 && (await state.getInflight(p.provider_code)) >= max;
}

function rotate(list, start) {
    const i = ((start % list.length) + list.length) % list.length;
    return list.slice(i).concat(list.slice(0, i));
}

function sortBy(list, keyFn) {
    //Array.sort is stable, so ties keep the provider_code order
    return list.map(p => [keyFn(p), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

function shuffle(list) {
    const a = [...list];
    for(let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function stripUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

async function nextCursor(scope) {
    return (await state.incr(PREFIX + "rr:" + scope, 86400)) - 1;
}

async function getUsage(code) {
    return await state.getNumber(PREFIX + "usage:" + code);
}

async function getStats(code) {
    const raw = await state.get(PREFIX + "stats:" + code);
    try {
        return raw ? JSON.parse(raw) : { latency: null };
    } catch(e) {
        return { latency: null };
    }
}

async function recordSuccess(code, latencyMs, config) {
    await state.incr(PREFIX + "usage:" + code, config.usageWindowSec, true);

    const stats = await getStats(code);
    const latency = stats.latency == null ? latencyMs : stats.latency + config.latencyAlpha * (latencyMs - stats.latency);
    await state.set(PREFIX + "stats:" + code, JSON.stringify({ latency: Math.round(latency) }), 86400 * 1000);

    await state.del(PREFIX + "fails:" + code);
}

//Breaker: failures are counted in a short-lived counter; reaching the threshold sets an "open" key that
//expires on its own when the cooldown is over, so there is no openUntil timestamp to compare across nodes
async function recordFailure(code, config) {
    const failures = await state.incr(PREFIX + "fails:" + code, Math.ceil(config.breaker.cooldownMs / 1000) + 60);
    if(failures >= config.breaker.failureThreshold) {
        await state.set(PREFIX + "open:" + code, "1", config.breaker.cooldownMs);
        await state.del(PREFIX + "fails:" + code);
    }
}

async function isBreakerOpen(code) {
    return await state.exists(PREFIX + "open:" + code);
}

function isRequestError(err) {
    const status = err?.status || err?.response?.status;
    return [400, 404, 413, 422].includes(status);
}

//True only when the failure shows the provider never took the request, so re-sending cannot duplicate it
function isSafeToResend(err) {
    const status = err?.status || err?.response?.status;
    if(status) return SAFE_STATUS.includes(status);
    return SAFE_NETWORK_CODES.includes(err?.code);
}

/*
 * Shared state. Redis first; on any Redis problem the same operation runs against this process's own
 * Map so a cache outage degrades balancing quality but never fails a provider request.
 */
const local = new Map(); //key -> { value, expiresAt }

function redisClient() {
    try {
        const r = _CACHE.getRedisInstance();
        return r && r.status === "ready" ? r : null;
    } catch(e) {
        return null;
    }
}

function localGet(key) {
    const e = local.get(key);
    if(!e) return null;
    if(e.expiresAt && Date.now() >= e.expiresAt) { local.delete(key); return null; }
    return e;
}

async function withRedis(redisFn, localFn) {
    const r = redisClient();
    if(r) {
        try {
            return await redisFn(r);
        } catch(e) {
            console.error("PROVIDER_LOAD_BALANCER: redis error, using local state -", e.message);
        }
    }
    return localFn();
}

const state = {
    //Atomic increment. fixedWindow: ttl is set once when the counter is created (usage window).
    //Otherwise the ttl is refreshed on every call so it only expires when idle.
    incr: (key, ttlSec, fixedWindow = false) => withRedis(
        async (r) => {
            const n = await r.incr(key);
            if(!fixedWindow || n === 1) await r.expire(key, ttlSec);
            return n;
        },
        () => {
            const e = localGet(key);
            const n = (e ? e.value : 0) + 1;
            local.set(key, { value: n, expiresAt: (fixedWindow && e) ? e.expiresAt : Date.now() + ttlSec * 1000 });
            return n;
        }
    ),

    get: (key) => withRedis(
        (r) => r.get(key),
        () => { const e = localGet(key); return e ? String(e.value) : null; }
    ),

    getNumber: async (key) => Number(await state.get(key)) || 0,

    set: (key, value, ttlMs) => withRedis(
        (r) => r.set(key, value, "PX", ttlMs),
        () => { local.set(key, { value, expiresAt: Date.now() + ttlMs }); }
    ),

    del: (key) => withRedis(
        (r) => r.del(key),
        () => { local.delete(key); }
    ),

    exists: (key) => withRedis(
        async (r) => (await r.exists(key)) > 0,
        () => !!localGet(key)
    ),

    //In-flight is a per-request entry with a deadline (Redis sorted set scored by deadline), not a counter.
    //A request that never reports back (node crash) falls out of the count when its deadline passes.
    startInflight: async (code, deadlineMs) => {
        const requestId = crypto.randomBytes(8).toString("hex");
        const key = PREFIX + "inflight:" + code;
        const deadline = Date.now() + deadlineMs;
        await withRedis(
            async (r) => {
                await r.zadd(key, deadline, requestId);
                await r.pexpire(key, deadlineMs * 2);
            },
            () => {
                const e = localGet(key) || { value: new Map(), expiresAt: 0 };
                e.value.set(requestId, deadline);
                e.expiresAt = Date.now() + deadlineMs * 2;
                local.set(key, e);
            }
        );
        return requestId;
    },

    endInflight: (code, requestId) => withRedis(
        (r) => r.zrem(PREFIX + "inflight:" + code, requestId),
        () => { const e = localGet(PREFIX + "inflight:" + code); if(e) e.value.delete(requestId); }
    ),

    getInflight: (code) => withRedis(
        async (r) => {
            const key = PREFIX + "inflight:" + code;
            await r.zremrangebyscore(key, "-inf", Date.now()); //drop entries from dead requests
            return await r.zcard(key);
        },
        () => {
            const e = localGet(PREFIX + "inflight:" + code);
            if(!e) return 0;
            for(const [id, deadline] of e.value) if(deadline <= Date.now()) e.value.delete(id);
            return e.value.size;
        }
    ),
};

//exposed for tests
module.exports._resetLocalState = () => local.clear();
