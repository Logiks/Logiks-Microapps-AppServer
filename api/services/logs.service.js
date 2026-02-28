//For Log Related Activities
// Very Specific, used by modules, general not required:
// log_apibox, log_autojobs, log_config_changes, log_data_changes, log_devices, log_rate_limit, log_security_roles
// log_logins, log_messages, log_notifications, log_migration, log_integrations, log_files, log_webhooks
// 
//
// Very Generic, Done in this file as event
//   log_audit
//   log_activities   
//   log_temp
//   log_errors
//
// Waiting:
//   log_operations - NA
//   log_export
//   log_feedbacks
//   log_system
//   log_tenant

module.exports = {
	name: "logs",

	actions: {
    },

    events: {
        //All Log Event Listeners
        async "logs.audit"(payload, nodeId) {
            // console.log("LOGS_AUDIT", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_audit", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",
                "nature": payload.nature || "-",
                "entity_type": payload.ref_src || "-",
                "entity_id": payload.ref_id || "-",
                "actor_role": "-",
                "before_state": JSON.stringify(payload.pre_data || {}), 
                "after_state": JSON.stringify(payload.data || {}), 
                "trace_id": payload.trace_id || "0",
                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });
        },

        async "logs.activity"(payload, nodeId) {
            // console.log("LOGS_ACTIVITY", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_audit", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",
                "ref_src": payload.ref_src || "-",
                "ref_id": payload.ref_id || "-",

                "subject": payload.subject || "-",
                "category": payload.category || "-",
                "subcategory": payload.subcategory || "-",
                "message": payload.message || "No Message Found",
                "unilink": payload.unilink || "",
                "tags": payload.tags || "",
                "status": payload.status || "new",
                
                "pre_data": JSON.stringify(payload.pre_data || {}), 
                "post_data": JSON.stringify(payload.post_data || {}), 
                "trace_id": payload.trace_id || "0",

                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });
        },

        async "logs.trace"(payload, nodeId) {
            // console.log("LOGS_TRACE_TEMP", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_audit", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",
                
                "uri": payload.uri || "-", 
                "req_body": payload.req_body || "-", 
                "xtras_1": payload.xtras_1 || "-", 
                "xtras_2": payload.xtras_2 || "-", 
                "xtras_3": payload.xtras_3 || "-", 
                
                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });
        },

        async "logs.error"(payload, nodeId) {
            // console.log("LOGS_TRACE_TEMP", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_audit", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",
                
                "error_key": payload.error_key || "-", 
                "entity_type": payload.entity_type || "error", 
                "error_code": payload.error_code || "412", 
                "error_message": payload.error_message || "", 
                "stack_trace": payload.stack_trace || "", 
                "request_id": payload.request_id || "0", 
                "severity": payload.severity || "medium", 

                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });
        }
    }
}