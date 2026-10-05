/*
 * APIBox Controller
 * This controls all the API requests going out of the system
 * 
 * sys_apibox           - APIBox Endpoint Configurations
 * log_apibox           - APIBox Run Logs
 * */

const qs = require('qs');

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","APIBox System Initialized");

        return true;
    },

    runAPI: async function(apiCode, payload = {}, providerCode = false, ctx) {
        if(!providerCode || !apiCode) return false;

        //, sys_apibox_env.end_point, sys_apibox_env.env_params
        const apiData = _DB.db_selectQ("appdb", "sys_apibox", "sys_apibox.*", {
            "sys_apibox.blocked": "false",
            "sys_apibox.api_code": apiCode,
            "sys_apibox.guid": [["global", ctx?.meta?.user?.guid || "global"], "IN"],
        });
        if (!apiData || !apiData.results) return false;

        const apiInfo = apiData.results[0];

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

    //Extract necessary information from apiInfo
    const {
        guid,
        api_code,
        debug, 
        use_cache, 
        use_mock, 
        format, 
        method, 
        env_code,
        subpath, 
        authorization, 
        authorization_token, 
        input_validation, 
        params, //other configurations
        headers, 
        query_obj,
        body, 
        output_transformation, 
        mockdata
    } = apiInfo;
    if(use_mock) return mockdata;

    var env_params = {};
    var end_point = "";
    try {
        const serverInfo = await PROVIDER.getInfo(guid, providerCode);

        end_point = (serverInfo?.server_url || '').replace(/\/+$/, '');
        env_params = JSON.parse(serverInfo.params || '{}');
    } catch(error) {
        env_params = {}
    }
    if(!end_point || end_point.length<=0) {
        throw new Error("Server URL not found");
    }
    
    const time1 = process.hrtime.bigint();
    const finalURL = end_point + (subpath ? subpath : '');

    const options = {
        url: finalURL,
        method: method.toUpperCase(),
        headers: {
            ...(authorization && authorization === 'token' ? {'Authorization': `Bearer ${authorization_token}`} : {}),
            ...MISC._replaceObj(_.extend({}, headers, dataParams.headers || {})),
        },
        data: MISC._replaceObj(_.extend({}, body || {}, dataParams.body || {})),
        timeout: apiInfo?.params?.timeout_ms || 30000
    };

    const QUERY_OBJ = _.extend({}, query_obj || {}, dataParams.query || {});

    if (method === 'GET' && QUERY_OBJ) {
        options.url += `?${qs.stringify(QUERY_OBJ)}`;
    }

    //Update the apibox table for last run
    _DB.db_updateQ("appdb", "sys_apibox", {
            "last_run": _DB.db_now(),
        }, {
            api_code: apiInfo.api_code
        });

    const logOptions = {
        ...options,
        headers: sanitizeHeaders(options.headers)
    };

    try {
        const response = await axios(options);

        const time2 = process.hrtime.bigint();

        if (debug) console.log(`Request sent to ${options.url} with method ${options.method}`, options);

        // if (output_transformation) response.data = output_transformation(response.data);

        // Get the HTTP status code
        const statusCode = response.status;

        //Create a log for the run
        _DB.db_insertQ1("logdb", "log_apibox", _.extend({
            guid: ctx.meta.user.guid, 
            api_code: apiInfo.api_code, 
            provider: providerCode, 
            method: method, 
            endpoint: finalURL, 
            status_code: statusCode, 
            latency_ms: Number(process.hrtime.bigint() - time1) / 1e6, 
            request_payload: JSON.stringify(logOptions), 
            response_payload: JSON.stringify(response.data), 
        }, MISC.generateDefaultDBRecord(ctx, false)));

        return response.data;
    } catch (error) {
        const time2 = process.hrtime.bigint();

        console.error(`Error sending request: ${error}`);
        //Create a log for the run
        _DB.db_insertQ1("logdb", "log_apibox", _.extend({
            guid: ctx.meta.user.guid, 
            api_code: apiInfo.api_code, 
            provider: providerCode,
            method: method, 
            endpoint: finalURL, 
            status_code: "ERR", 
            latency_ms: Number(process.hrtime.bigint() - time1) / 1e6, 
            request_payload: JSON.stringify(logOptions), 
            response_payload: JSON.stringify(error?.response || error), 
        }, MISC.generateDefaultDBRecord(ctx, false)));
        
        throw error;
    }
}


function sanitizeHeaders(headers = {}) {
    const sanitized = { ...headers };

    for (const key of Object.keys(sanitized)) {
        if (
            ['authorization', 'cookie', 'set-cookie', 'x-api-key'].includes(
                key.toLowerCase()
            )
        ) {
            sanitized[key] = '[REDACTED]';
        }
    }

    return sanitized;
}