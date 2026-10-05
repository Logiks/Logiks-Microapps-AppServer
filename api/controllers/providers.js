/*
 * Remote Server Management Controller
 * This controller is responsible for connecting to remote servers, workers, and agents for various modules and applications. 
 * It provides functionalities to handle server-related operations via various endpoints and services for these remote entities.
 * 
 * sys_providers : Manage Remote Servers, Workers and Agents for modules and apps
 * 
 * eg: analytics101, sysops, reporting_servers, etc
 * 
 * Based on type of server - health, status, and other endpoints can be configured for each server type.
 * Based on the server type, the controller can handle different types of requests and responses, ensuring that the system can effectively communicate with and manage these remote servers.
 * 
 * The controller also maintains logs of all interactions with the remote servers, including request and response payloads, status codes, and latency metrics. This logging functionality is crucial for monitoring the health and performance of the remote servers and for troubleshooting any issues that may arise during communication.
 * The controller is designed to be flexible and extensible, allowing for the addition of new server types and endpoints as needed. It can be integrated with other modules and applications within the system, providing a centralized point of management for all remote server interactions.
 * The controller also supports various authentication mechanisms for secure communication with remote servers, ensuring that sensitive data is protected during transmission.
 * 
 * Overall, this controller plays a vital role in enabling efficient and effective management of remote servers, workers, and agents within the system, contributing to the overall stability and performance of the applications it supports.
 * 
 * controls =  health, restart, status, metrics, logs, config, update, deploy, backup, restore, shutdown
 * */

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","Remote Server Management Controller Initialized");

        //Health check endpoints to check health of assocciated servers

        return true;
    },

    getType: function() {
        return CONFIG.REMOTE_SERVER_TYPE || [
            "sysops",
            "analytics101",
            // "reporting",
            // "worker",
            // "agent"
        ];
    },

    list: async function(guid, categoryCode = false) {
        var whereCond = {
            "blocked": "false",
            "guid": [["global", guid], "IN"],
        };
        if(categoryCode) {
            whereCond.category_code = categoryCode;
        }
        var serverData = await _DB.db_selectQ("appdb", "sys_providers", "*", whereCond, {});
        if(!serverData || !serverData.results || serverData.results.length<=0) {
            return [];
        }
        return serverData.results;
    },

    getInfo: async function(guid, providerCode) {
        var whereCond = {
            "blocked": "false",
            "guid": [["global", guid], "IN"],
            "provider_code": providerCode
        };
        var serverData = await _DB.db_selectQ("appdb", "sys_providers", "*", whereCond, {});
        if(!serverData || !serverData.results || serverData.results.length<=0) {
            return null;
        }
        return serverData.results[0];
    },

    send: async function(guid, providerCode, endpoint, payload, optionParams = {}, method = "POST") {
        var serverInfo = await this.getServerInfo(guid, providerCode);
        if(!serverInfo) {
            throw new Error("Server not found");
        }
        var serverUrl = serverInfo.server_url;
        if(!serverUrl) {
            throw new Error("Server URL not found");
        }
        var finalURL = serverUrl + endpoint;// + (subpath ? subpath : '');
        var headers = optionParams.headers || {};
        var timeout = optionParams.timeout || 5000;
        const time1 = process.hrtime.bigint();
        // var response = await _HTTP.request(url, method, payload, headers, timeout);
        // return response;

        const options = {
            url: finalURL,
            method: method.toUpperCase(),
            headers: {
                ...(serverInfo.authorization && serverInfo.authorization === 'apikey' ? {'Authorization': `Bearer ${serverInfo.authorization_key}`} : {}),
                ...MISC._replaceObj(_.extend({}, headers)),//, dataParams.headers || {}
            },
            data: {},
            timeout: optionParams.timeout_ms || 30000
        };

        if(payload) {
            if (method === 'GET') {
                const QUERY_OBJ = MISC._replaceObj(_.extend({}, payload || {}, options.body || {}));
                options.url += `?${qs.stringify(QUERY_OBJ)}`;
            } else {
                options.data = MISC._replaceObj(_.extend({}, payload || {}, options.body || {}));
            }
        }
        
        //Update the server table for last run
        _DB.db_updateQ("appdb", "sys_providers", {
                "last_run": _DB.db_now(),
            }, {
                provider_code: providerCode
            });


        try {
            const response = await axios(options);

            const time2 = process.hrtime.bigint();

            if (options.debug) console.log(`Request sent to ${options.url} with method ${options.method}`, options);

            // Get the HTTP status code
            const statusCode = response.status;

            //Create a log for the run
            _DB.db_insertQ1("logdb", "log_providers", _.extend({
                guid: ctx.meta.user.guid, 
                category_code: "",
                provider_code: providerCode, 
                env_code: env_code, 
                method: method, 
                endpoint: finalURL, 
                status_code: statusCode, 
                latency_ms: Number(process.hrtime.bigint() - time1) / 1e6, 
                request_payload: JSON.stringify(options), 
                response_payload: JSON.stringify(response.data)
            }, MISC.generateDefaultDBRecord(ctx, false)));

            return response.data;
        } catch (error) {
            const time2 = process.hrtime.bigint();

            console.error(`Error sending request: ${error.message}`, error);
            
            //Create a log for the run
            _DB.db_insertQ1("logdb", "log_providers", _.extend({
                guid: ctx.meta.user.guid, 
                category_code: "",
                provider_code: providerCode, 
                env_code: env_code, 
                method: method, 
                endpoint: finalURL, 
                status_code: "ERR", 
                latency_ms: Number(process.hrtime.bigint() - time1) / 1e6, 
                request_payload: JSON.stringify(options), 
                response_payload: JSON.stringify(error?.response || error), 
            }, MISC.generateDefaultDBRecord(ctx, false)));
            
            throw error;
        }
    },

    runControl: async function(guid, providerCode, control, payload = {}, optionParams = {}) {
        return await APIBOX.sendRequest(providerCode, {
            guid: guid,
            api_code: `providers_${control}`,
            subpath: `/${control}`,
            method: "POST",
            dataParams: {
                body: payload
            },
            ..._.extend({
                debug: false, 
                cache_ttl: 0, 
                use_mock: false, 
                format: "json", 
                authorization: "", 
                authorization_token: "", 
                input_validation: {}, 
                params: {}, //other configurations
                headers: {}, 
                query_obj: {},
                body: {}, 
                output_transformation: {}, 
                mockdata: false,
            }, optionParams)
        }, payload, {meta:{user:{guid}}});
    }
}