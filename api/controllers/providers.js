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

const qs = require('qs');

const PROTECTED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];
const CONTROLS = ["health", "restart", "status", "metrics", "logs", "config", "update", "deploy", "backup", "restore", "shutdown"];
const MAX_LOG_PAYLOAD = 64 * 1024;

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
        var serverInfo = await this.getInfo(guid, providerCode);
        if(!serverInfo) {
            throw new Error("Server not found");
        }
        var serverUrl = (serverInfo.server_url || '').replace(/\/+$/, '');
        if(!serverUrl) {
            throw new Error("Server URL not found");
        }
        method = String(method || "POST").toUpperCase();
        endpoint = String(endpoint || '');
        if(endpoint && !endpoint.startsWith('/')) endpoint = '/' + endpoint;

        var finalURL = serverUrl + endpoint;
        var headers = optionParams.headers || {};
        const time1 = process.hrtime.bigint();
        const ctx = {meta: {user: {guid: guid}}};

        // Caller headers cannot carry credentials; provider auth is applied last
        const callerHeaders = _.omitBy(headers, (v, k) => PROTECTED_HEADERS.includes(String(k).toLowerCase()));
        const options = {
            url: finalURL,
            method: method,
            headers: {
                ...MISC._replaceObj(callerHeaders),
                ...(serverInfo.authorization === 'apikey' && serverInfo.authorization_key ? {'Authorization': `Bearer ${serverInfo.authorization_key}`} : {}),
            },
            data: {},
            timeout: optionParams.timeout_ms || optionParams.timeout || 30000
        };

        if(payload) {
            if (method === 'GET') {
                options.url += `${options.url.includes('?') ? '&' : '?'}${qs.stringify(MISC._replaceObj(payload))}`;
            } else {
                options.data = MISC._replaceObj(payload);
            }
        }

        //Update the server table for last run
        _DB.db_updateQ("appdb", "sys_providers", {
                "last_run": _DB.db_now(),
            }, {
                provider_code: providerCode
            });

        const logOptions = {
            ...options,
            headers: sanitizeHeaders(options.headers)
        };

        const writeLog = (statusCode, responsePayload) => {
            Promise.resolve(_DB.db_insertQ1("logdb", "log_providers", _.extend({
                category_code: serverInfo.category_code || "",
                server_code: providerCode, 
                method: method, 
                endpoint: String(finalURL).substring(0, 255), 
                status_code: statusCode, 
                latency_ms: Math.round(Number(process.hrtime.bigint() - time1) / 1e6), 
                request_payload: truncate(JSON.stringify(logOptions)), 
                response_payload: truncate(responsePayload)
            }, MISC.generateDefaultDBRecord(ctx, false)))).catch(e => {
                console.error("PROVIDERS log write failed", e.message);
            });
        };

        try {
            const response = await axios(options);

            if (serverInfo.debug === 'true') console.log(`Request sent to ${logOptions.url} with method ${logOptions.method}`, logOptions);

            writeLog(response.status, JSON.stringify(response.data));

            return response.data;
        } catch (error) {
            console.error(`Error sending request: ${error.message}`);

            // status_code is an int column; 0 = no HTTP response (network error, timeout)
            writeLog(error?.response?.status || 0, JSON.stringify(error?.response?.data ?? {error: error.message}));

            throw error;
        }
    },

    runControl: async function(guid, providerCode, control, payload = {}, optionParams = {}) {
        if(!CONTROLS.includes(control)) {
            throw new Error("Unsupported provider control: " + control);
        }

        return await APIBOX.sendRequest(providerCode, _.extend({
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
        }, optionParams, {
            guid: guid,
            api_code: `providers_${control}`,
            subpath: `/${control}`,
            method: "POST",
        }), {body: payload}, {meta:{user:{guid}}});
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

function truncate(str) {
    str = typeof str === 'string' ? str : String(str);
    return str.length > MAX_LOG_PAYLOAD ? str.substring(0, MAX_LOG_PAYLOAD) + '...[truncated]' : str;
}
