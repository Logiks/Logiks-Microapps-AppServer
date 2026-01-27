/*
 * Webhooks Controller
 * This controls all external API endpoint provider for automation, cron jobs and data extractors
 * Works with Header Keys and IP Whitelisting
 * No Authentication System is required to use webhooks
 * 
 * */

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","Webhook System Initialized");
    },

    receiveRequest: async function(endpoint, ctx) {
        console.log("\x1b[35m%s\x1b[0m","WEBHOOK RECIEVED", endpoint, ctx.query, ctx.params, ctx.headers, ctx.meta);
        const time1 = _DB.db_nowunix();

        const logRecord = await _DB.db_insertQ1("logdb", "log_webhooks", _.extend({
            appid: ctx.meta.appInfo.appid || "unknown", 
            webhook: endpoint, 
            method: ctx.meta.method, 
            ip_address: ctx.meta.remoteIP || "0.0.0.0", 
            user_agent: ctx.meta.headers["user-agent"] || "",
            latency_ms: 0, 
            status_code: 0, 
            request_payload: JSON.stringify({
                query: ctx.query, 
                params: ctx.params, 
                headers: ctx.headers, 
            }), 
            response_payload: JSON.stringify({}),
        }, MISC.generateDefaultDBRecord(ctx, false)));
        // console.log("LOG RECORD ID", logRecord.insertId);
        
        const webhookData = await _DB.db_selectQ("appdb", "sys_webhooks", "*", { 
                endpointid: endpoint, 
                method: ctx.meta.method, 
                site: ctx.meta.appInfo.appid || "default",
                blocked: "false" 
            });
        if(!webhookData || webhookData?.results.length == 0) {
            console.log("\x1b[31m%s\x1b[0m","WEBHOOK NOT FOUND OR BLOCKED", endpoint);

            _DB.db_updateQ("logdb", "log_webhooks", {
                latency_ms: (_DB.db_nowunix()-time1), 
                status_code: "404",
                error_message: "Webhook Not Found or Blocked",
                response_payload: JSON.stringify({"error": "Webhook Not Found or Blocked"}),
            }, {
                id: logRecord.insertId
            });

            return {
                "status": "error",
                "message": "Webhook Not Found or Blocked"
            }
        }

        // params, 
        
        const webhookInfo = webhookData.results[0];
        var response  = {};

        if(webhookInfo.authkey && webhookInfo.authkey != "") {
            const reqAuthKey = ctx.headers["x-webhook-auth"] || ctx.query.auth || ctx.params.auth || "";
            if(reqAuthKey != webhookInfo.authkey) {
                console.log("\x1b[31m%s\x1b[0m","WEBHOOK AUTH FAILED", endpoint);

                _DB.db_updateQ("logdb", "log_webhooks", {
                    guid: webhookInfo.guid,
                    latency_ms: (_DB.db_nowunix()-time1), 
                    status_code: "401",
                    error_message: "Unauthorized: Invalid Auth Key",
                    response_payload: JSON.stringify({"error": "Unauthorized: Invalid Auth Key"}),
                }, {
                    id: logRecord.insertId
                });

                return {
                    "status": "error",
                    "message": "Unauthorized: Invalid Auth Key"
                }
            }
        }
        var vStatus = VALIDATIONS.validateRule(ctx.params, webhookInfo.validations || {});
        if (!vStatus.status) {
            console.log("\x1b[31m%s\x1b[0m","WEBHOOK VALIDATION FAILED", endpoint, vStatus.errors);

            _DB.db_updateQ("logdb", "log_webhooks", {
                guid: webhookInfo.guid,
                latency_ms: (_DB.db_nowunix()-time1), 
                status_code: "400",
                error_message: "Input Validation Failed",
                response_payload: JSON.stringify({"error": "Input Validation Failed", "details": vStatus.errors}),
            }, {
                id: logRecord.insertId
            });

            return {
                "status": "error",
                "message": "Input Validation Failed",
                "errors": vStatus.errors
            }
        }
        
        if(webhookInfo.func_name && webhookInfo.func_name != "") {
            try {
                const funcResponse = await MISC.executeFunctionByName(webhookInfo.func_name, _.extend({}, webhookInfo.params || {}, ctx.params), ctx);
                response = funcResponse;

                _DB.db_updateQ("logdb", "log_webhooks", {
                    guid: webhookInfo.guid,
                    latency_ms: (_DB.db_nowunix()-time1), 
                    status_code: "200",
                    response_payload: (webhookInfo.keep_log=="true"?JSON.stringify(response):JSON.stringify({"msg": "Response hidden as per webhook settings"})),
                }, {
                    id: logRecord.insertId
                });
                
                return {
                    "status": "success",
                    "message": response
                }
            } catch(err) {
                console.log("\x1b[31m%s\x1b[0m","WEBHOOK FUNCTION EXECUTION FAILED", endpoint, err);

                _DB.db_updateQ("logdb", "log_webhooks", {
                    guid: webhookInfo.guid,
                    latency_ms: (_DB.db_nowunix()-time1), 
                    status_code: "500",
                    error_message: "Webhook Function Execution Failed",
                    response_payload: JSON.stringify({"error": "Webhook Function Execution Failed", "details": err.message}),
                }, {
                    id: logRecord.insertId
                });

                return {
                    "status": "error",
                    "message": "Webhook Function Execution Failed",
                    "errors": err.message
                }
            }
        } else {
            console.log("\x1b[31m%s\x1b[0m","WEBHOOK FUNCTION NOT DEFINED", endpoint, err);

            _DB.db_updateQ("logdb", "log_webhooks", {
                guid: webhookInfo.guid,
                latency_ms: (_DB.db_nowunix()-time1), 
                status_code: "500",
                error_message: "Webhook Function Not Defined",
                response_payload: JSON.stringify({"error": "Webhook Function Not Defined", "details": err.message}),
            }, {
                id: logRecord.insertId
            });

            return {
                "status": "error",
                "message": "Webhook Function Not Defined",
            }
        }
    }
}
