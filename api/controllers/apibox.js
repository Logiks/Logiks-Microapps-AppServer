/*
 * APIHub Controller
 * This controls all the API requests going out of the system
 * 
 * */

const qs = require('qs');

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","APIHub System Initialized");

        return true;
    },

    runAPI: async function(apiCode, params = {}, ctx = null) {
        if(!apiCode) return false;

        const apiData = _DB.db_selectQ("appdb", "sys_apibox", "*", {
            blocked: "false",
            api_code: apiCode,
            guid: ctx?.meta?.user?.guid || "global"
        });
        if(!apiData || apiData?.results) apiData.results = [];

        const apiInfo = apiData.results[0];

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
        end_point, 
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
    
    const time1 = _DB.db_nowunix();
    const finalURL = end_point + (subpath ? subpath : '');

    const options = {
        url: finalURL,
        method: method.toUpperCase(),
        headers: {
            ...(authorization && authorization === 'token' ? {'Authorization': `Bearer ${authorization_token}`} : {}),
            ...MISC._replaceObj(_.extend({}, headers, dataParams.headers || {})),
        },
        data: MISC._replaceObj(_.extend({}, body || {}, dataParams.body || {})),
    };

    const QUERY_OBJ = _.extend({}, query_obj || {}, dataParams.query || {});

    if (method === 'GET' && QUERY_OBJ) {
        options.url += `?${qs.stringify(QUERY_OBJ)}`;
    }

    //Update the apihub table for last run
    _DB.db_updateQ("appdb", "sys_apibox", {
            "last_run": _DB.db_now(),
        }, {
            api_code: apiCode
        });

    try {
        const response = await axios(options);

        const time2 = _DB.db_nowunix();

        if (debug) console.log(`Request sent to ${options.url} with method ${options.method}`, options);

        // if (output_transformation) response.data = output_transformation(response.data);

        // Get the HTTP status code
        const statusCode = response.status;

        //Create a log for the run
        _DB.db_insertQ1("logdb", "log_apihub", _.extend({
            appid: ctx.meta.user.guid, 
            api_code: apiCode, 
            method: method, 
            endpoint: finalURL, 
            status_code: statusCode, 
            latency_ms: time2-time1, 
            request_payload: JSON.stringify(options), 
            response_payload: JSON.stringify(response.data), 
        }, MISC.generateDefaultDBRecord(ctx, false)));

        return response.data;
    } catch (error) {
        const time2 = _DB.db_nowunix();

        console.error(`Error sending request: ${error}`);
        //Create a log for the run
        _DB.db_insertQ1("logdb", "log_apihub", _.extend({
            appid: ctx.meta.user.guid, 
            api_code: apiCode, 
            method: method, 
            endpoint: finalURL, 
            status_code: "ERR", 
            latency_ms: time2-time1, 
            request_payload: JSON.stringify(options), 
            response_payload: JSON.stringify(error?.response || error), 
        }, MISC.generateDefaultDBRecord(ctx, false)));
        
        throw error;
    }
}
