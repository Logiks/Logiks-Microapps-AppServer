/*
 * APIBox Controller
 * This controls all the API requests going out of the system
 * 
 * sys_apibox           - APIBox Endpoint Configurations
 * log_apibox           - APIBox Run Logs
 * 
 * Depends on the provider controller to get the server information and endpoint configurations for each provider.
 * 
 * Sample Usage:
 * // Run an API request
 * const apiCode = 'example_api_code';
 * const payload = { key1: 'value1', key2: 'value2' };
 * const providerCode = 'example_provider_code';
 * const ctx = { meta: { user: { guid: 'user_guid' } } };
 * 
 * APIBOX.runAPI(apiCode, payload, providerCode, ctx)
 *     .then(response => {
 *         console.log('API Response:', response);
 *     })
 *     .catch(error => {
 *         console.error('API Error:', error);
 *     });
 * APIBOX.sendRequest(providerCode, {
 *  subpath
 * }, payload = {}, ctx)
 * */

const qs = require('qs');
const crypto = require('crypto');

// Headers a caller may never set; auth comes only from the stored definition / provider
const PROTECTED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","APIBox System Initialized");

        return true;
    },

    runAPI: async function(apiCode, payload = {}, providerCode = false, ctx) {
        if(!apiCode) return false;

        const apiData = await _DB.db_selectQ("appdb", "sys_apibox", "sys_apibox.*", {
            "sys_apibox.blocked": "false",
            "sys_apibox.api_code": apiCode,
            "sys_apibox.guid": [["global", ctx?.meta?.user?.guid || "global"], "IN"],
        });
        if (!apiData || !apiData.results || apiData.results.length <= 0) return false;

        // Prefer the tenant's own definition over the global one
        const rows = apiData.results;
        const apiInfo = rows.find(r => r.guid !== "global") || rows[0];

        if(!providerCode) {
            providerCode = apiInfo.provider;
        }

        return await sendRequest(providerCode, apiInfo, payload, ctx);
    },

    sendRequest: async function(providerCode, apiInfo, payload = {}, ctx) {
        return await sendRequest(providerCode, apiInfo, payload, ctx);
    }
}

async function sendRequest(providerCode, apiInfo, dataParams, ctx) {
    //validate the apiInfo and providerCode
    if(!providerCode || !apiInfo || !apiInfo.api_code) {
        throw new Error("Invalid provider code or API information");
    }
    dataParams = dataParams || {};

    apiInfo = _.extend({
        guid: "global",
        debug: false, 
        cache_ttl: 0, 
        use_mock: false, 
        format: "json", 
        method: "POST", 
        input_validation: false, 
        params: {}, //other configurations
        headers: {}, 
        query_obj: {},
        body: {}, 
        output_transformation: {}, 
        mockdata: false
    }, apiInfo);

    //Extract necessary information from apiInfo
    const {
        api_code,
        format, 
        subpath, 
        authorization, 
        authorization_token, 
        input_validation, 
        output_transformation
    } = apiInfo;

    // DB enum('false','true') and text-JSON columns arrive as strings
    const guid = ctx?.meta?.user?.guid || apiInfo.guid || "global";
    const debug = isTrue(apiInfo.debug);
    const use_mock = isTrue(apiInfo.use_mock);
    const cache_ttl = parseInt(apiInfo.cache_ttl) || 0;
    const method = String(apiInfo.method || "POST").toUpperCase();
    const params = parseJSON(apiInfo.params, {});
    const headers = parseJSON(apiInfo.headers, {});
    const query_obj = parseJSON(apiInfo.query_obj, {});
    const body = parseJSON(apiInfo.body, {});

    if(use_mock) return parseJSON(apiInfo.mockdata, apiInfo.mockdata);

    const cacheKey = "APIBOX:" + crypto.createHash("sha256").update(JSON.stringify([
        guid, providerCode, api_code, subpath || "", method,
        dataParams.query || {}, dataParams.body || {}
    ])).digest("hex");

    if(cache_ttl > 0) {
        const cacheData = await _CACHE.fetchDataSync(cacheKey);
        if(cacheData) {
            return cacheData;
        }
    }

    const serverInfo = await PROVIDERS.getInfo(guid, providerCode);
    const end_point = (serverInfo?.server_url || '').replace(/\/+$/, '');
    if(!end_point) {
        throw new Error("Server URL not found");
    }
    const providerParams = parseJSON(serverInfo.params, {});

    const time1 = process.hrtime.bigint();
    const finalURL = end_point + (subpath ? subpath : '');

    // Caller headers first (minus protected ones), stored definition headers and credentials last so they always win
    const callerHeaders = _.omitBy(dataParams.headers || {}, (v, k) => PROTECTED_HEADERS.includes(String(k).toLowerCase()));
    const options = {
        url: finalURL,
        method: method,
        headers: {
            ...MISC._replaceObj(callerHeaders),
            ...MISC._replaceObj(headers),
            ...(serverInfo.authorization === 'apikey' && serverInfo.authorization_key ? {'Authorization': `Bearer ${serverInfo.authorization_key}`} : {}),
            ...(authorization === 'token' && authorization_token ? {'Authorization': `Bearer ${authorization_token}`} : {}),
        },
        data: MISC._replaceObj(_.extend({}, body, dataParams.body || {})),
        timeout: params.timeout_ms || providerParams.timeout_ms || 30000
    };

    const QUERY_OBJ = _.extend({}, query_obj, dataParams.query || {});
    if (Object.keys(QUERY_OBJ).length > 0) {
        options.url += `${options.url.includes('?') ? '&' : '?'}${qs.stringify(QUERY_OBJ)}`;
    }

    //Update the apibox table for last run
    _DB.db_updateQ("appdb", "sys_apibox", {
            "last_run": _DB.db_now(),
        }, {
            api_code: api_code
        });

    const logOptions = {
        ...options,
        headers: sanitizeHeaders(options.headers)
    };

    const writeLog = (statusCode, responsePayload) => {
        Promise.resolve(_DB.db_insertQ1("logdb", "log_apibox", _.extend({
            api_code: api_code, 
            provider: providerCode, 
            method: method, 
            endpoint: String(finalURL).substring(0, 255), 
            status_code: statusCode, 
            latency_ms: Math.round(Number(process.hrtime.bigint() - time1) / 1e6), 
            request_payload: JSON.stringify(logOptions), 
            response_payload: responsePayload, 
        }, MISC.generateDefaultDBRecord(ctx || {guid: guid}, false)))).catch(e => {
            console.error("APIBOX log write failed", e.message);
        });
    };

    try {
        const response = await axios(options);

        if (debug) console.log(`Request sent to ${logOptions.url} with method ${logOptions.method}`, logOptions);

        // if (output_transformation) response.data = output_transformation(response.data);

        writeLog(response.status, JSON.stringify(response.data));

        if(cache_ttl > 0) {
            await _CACHE.storeDataEx(cacheKey, response.data, cache_ttl);
        }

        return response.data;
    } catch (error) {
        console.error(`Error sending request: ${error.message}`);

        // status_code is an int column; 0 = no HTTP response (network error, timeout)
        writeLog(error?.response?.status || 0, JSON.stringify(error?.response?.data ?? {error: error.message}));

        throw error;
    }
}

function isTrue(v) {
    return v === true || v === 'true' || v === 1 || v === '1';
}

function parseJSON(v, fallback) {
    if(v === null || v === undefined || v === '') return fallback;
    if(typeof v !== 'string') return v;
    try {
        return JSON.parse(v);
    } catch(e) {
        return fallback;
    }
}

function sanitizeHeaders(headers = {}) {
    const sanitized = { ...headers };

    for (const key of Object.keys(sanitized)) {
        if (PROTECTED_HEADERS.includes(key.toLowerCase())) {
            sanitized[key] = '[REDACTED]';
        }
    }

    return sanitized;
}
