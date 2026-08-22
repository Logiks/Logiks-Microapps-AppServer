/*
 * APIBox Controller
 * This controls all the API requests going out of the system
 * 
 * sys_apibox           - APIBox Endpoint Configurations
 * sys_apibox_env       - APIBox Environment Variables
 * > sys_apibox.env_code = sys_apibox_env.env_code
 * log_apibox           - APIBox Run Logs
 * */

const qs = require('qs');

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","APIBox System Initialized");

        return true;
    },

    runAPI: async function(apiCode, params = {}, ctx) {
        if(!apiCode) return false;

        const apiData = _DB.db_selectQ("appdb", "sys_apibox,sys_apibox_env", "sys_apibox.*, sys_apibox_env.end_point, sys_apibox_env.env_params", {
            "sys_apibox.blocked": "false",
            "sys_apibox_env.blocked": "false",
            "sys_apibox.api_code": apiCode,
            "sys_apibox.guid": [["global", ctx?.meta?.user?.guid || "global"], "IN"],
            "sys_apibox.env_code = sys_apibox_env.env_code": "RAW"
        });
        if (!apiData || !apiData.results) return false;

        const apiInfo = apiData.results[0];

        try {
            apiInfo['env_params'] = JSON.parse(apiInfo['env_params'] || '{}');
        } catch (error) {
            apiInfo['env_params'] = {};
        }

        return await sendRequest(apiCode, apiInfo, params, ctx);
    }
}

async function sendRequest(apiCode, apiInfo, dataParams, ctx) {
    const {
        debug, 
        use_cache, 
        use_mock, 
        format, 
        method, 
        env_code,
        end_point, 
        env_params,
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
            api_code: apiCode
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
            api_code: apiCode, 
            env_code: env_code, 
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
            api_code: apiCode, 
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