//Wraps the configured engine list with retry, per-attempt timeout, a
//per-engine circuit breaker (state kept in _CACHE so it's shared across
//worker nodes, not just this process), and fallback to the next engine by
//priority. This is the "fully resilient" half of the agent loop - it does
//NOT cache/dedupe responses, since LLM generation isn't idempotent.

const BREAKER_PREFIX = "aicore:breaker:";

//engines: [{ key, priority, instance }] sorted ascending by priority (from ./index.js)
//returns: engine result plus which engine actually served it
async function callEngine(engines, sessId, messages, tools, userInfo, params, resilienceConfig = {}) {
    const retryConfig = resilienceConfig.retry || {};
    const breakerConfig = resilienceConfig.breaker || {};

    let lastErr = new Error("No AI engines configured");

    for (const engine of engines) {
        if (await isBreakerOpen(engine.key)) {
            console.log("\x1b[33m%s\x1b[0m", `AICore: skipping engine '${engine.key}' - circuit breaker open`);
            continue;
        }

        try {
            const result = await withRetry(
                () => engine.instance.sendMessage(sessId, messages, tools, userInfo, params),
                retryConfig
            );
            await recordSuccess(engine.key);
            return { ...result, engineKey: engine.key };
        } catch (err) {
            lastErr = err;
            console.error(`AICore: engine '${engine.key}' failed`, err.message);
            await recordFailure(engine.key, breakerConfig);
        }
    }

    throw lastErr;
}

async function withRetry(fn, { maxAttempts = 2, baseDelayMs = 200, timeoutMs } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await withTimeout(fn(), timeoutMs);
        } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) await sleep(baseDelayMs * attempt);
        }
    }
    throw lastErr;
}

function withTimeout(promise, timeoutMs) {
    if (!timeoutMs) return promise;
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Engine call timed out after ${timeoutMs}ms`)), timeoutMs))
    ]);
}

async function isBreakerOpen(engineKey) {
    const state = await _CACHE.fetchDataSync(BREAKER_PREFIX + engineKey, null);
    return !!state && Date.now() < state.openUntil;
}

async function recordFailure(engineKey, breakerConfig) {
    const failureThreshold = breakerConfig.failureThreshold || 3;
    const cooldownMs = breakerConfig.cooldownMs || 30000;

    const key = BREAKER_PREFIX + engineKey;
    const state = (await _CACHE.fetchDataSync(key, null)) || { failures: 0, openUntil: 0 };
    state.failures += 1;

    if (state.failures >= failureThreshold) {
        state.openUntil = Date.now() + cooldownMs;
        state.failures = 0;
        console.log("\x1b[31m%s\x1b[0m", `AICore: circuit breaker OPEN for engine '${engineKey}' for ${cooldownMs}ms`);
    }

    await _CACHE.storeDataEx(key, state, Math.ceil(cooldownMs / 1000) + 60);
}

async function recordSuccess(engineKey) {
    await _CACHE.deleteKey(BREAKER_PREFIX + engineKey);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { callEngine };
