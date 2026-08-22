/*
 * Remote Server Management Controller
 * This controller is responsible for connecting to remote servers, workers, and agents for various modules and applications. 
 * It provides functionalities to handle server-related operations via various endpoints and services for these remote entities.
 * 
 * sys_servers : Manage Remote Servers, Workers and Agents for modules and apps
 * 
 * eg: analytics101, sysops, reporting_servers, etc
 * */

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","Remote Server Management Controller Initialized");
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

    getServerList: async function(guid, categoryCode = false) {
        var whereCond = {
            "blocked": "false",
            "guid": [["global", guid], "IN"],
        };
        if(categoryCode) {
            whereCond.category_code = categoryCode;
        }
        var serverData = await _DB.db_selectQ("appdb", "sys_servers", "*", whereCond, {});
        if(!serverData || !serverData.results || serverData.results.length<=0) {
            return [];
        }
        return serverData.results;
    },

    getServerInfo: async function(guid, serverCode) {
        var whereCond = {
            "blocked": "false",
            "guid": [["global", guid], "IN"],
            "server_code": serverCode
        };
        var serverData = await _DB.db_selectQ("appdb", "sys_servers", "*", whereCond, {});
        if(!serverData || !serverData.results || serverData.results.length<=0) {
            return null;
        }
        return serverData.results[0];
    },

    send: async function(guid, serverCode, endpoint, payload, optionParams = {}, method = "POST") {
        var serverInfo = await this.getServerInfo(guid, serverCode);
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
        _DB.db_updateQ("appdb", "sys_servers", {
                "last_run": _DB.db_now(),
            }, {
                server_code: serverCode
            });


        try {
            const response = await axios(options);

            const time2 = process.hrtime.bigint();

            if (options.debug) console.log(`Request sent to ${options.url} with method ${options.method}`, options);

            // Get the HTTP status code
            const statusCode = response.status;

            //Create a log for the run
            _DB.db_insertQ1("logdb", "log_servers", _.extend({
                guid: ctx.meta.user.guid, 
                category_code: "",
                server_code: serverCode, 
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
            _DB.db_insertQ1("logdb", "log_servers", _.extend({
                guid: ctx.meta.user.guid, 
                category_code: "",
                server_code: serverCode, 
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
    }
}