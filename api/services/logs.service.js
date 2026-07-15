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
//   log_export
//   log_feedbacks
//   log_system
//   log_tenant

const NO_LOGS = CONFIG.nologs || {};

module.exports = {
	name: "logs",

	actions: {
    },

    events: {
        //All Log Event Listeners
        async "logs.audit"(payload, nodeId) {
            // log_info("LOGS_AUDIT", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            await _DB.db_insertQ1("logdb", "log_audit", {
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

            _DB.db_query("logdb", "UPDATE log_audit SET before_hash = sha1(before_state), after_hash = sha1(after_state) where before_hash IS NULL OR length(before_hash)<=0;", {});
        },

        async "logs.activity"(payload, nodeId) {
            // log_info("LOGS_ACTIVITY", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            var ref_src = payload.ref_src || "-";
            if(ref_src.indexOf("@")>=0) ref_src = ref_src.split("@").splice(0,2).join("@");

            if(NO_LOGS?.activities.indexOf(ref_src.split("@")[1]) !== -1) return;

            await _DB.db_insertQ1("logdb", "log_activities", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",
                "ref_src": ref_src,
                "ref_id": payload.ref_id || "-",

                "subject": payload.subject || "-",
                "category": payload.category || "-",
                "subcategory": payload.subcategory || "-",
                "message": payload.message || `${payload.subject} - ${payload.category}`,
                "unilink": payload.unilink || "",
                "tags": payload.tags || "",
                "status": payload.status || "new",
                
                "pre_data": JSON.stringify(payload.pre_data || {}), 
                "post_data": JSON.stringify(payload.post_data || payload.data || {}), 
                "trace_id": payload.trace_id || "0",

                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });

            _DB.db_query("logdb", "UPDATE log_activities SET pre_hash = sha1(pre_data), post_hash = sha1(post_data) where pre_hash IS NULL OR length(pre_hash)<=0;", {});
        },

        async "logs.trace"(payload, nodeId) {
            log_debug("LOGS_TRACE_TEMP", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_temp", {
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
            log_error("LOGS_TRACE_TEMP", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_errors", {
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
        },

        async "logs.notify"(payload, nodeId) {
            var vStatus = VALIDATIONS.validateRule(payload, {
                "ref_src": "required",
                "ref_id": "required",
            });
            if (!vStatus.status) {
                throw new LogiksError(
                    "Message Validation Failed",
                    400,
                    "VALIDATION_ERROR",
                    vStatus.errors
                );
            }
            // log_info("LOGS_ACTIVITY", payload);
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_notifications", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",
                "dated": dated,

                "ref_src": payload.ref_src,
                "ref_id": payload.ref_id,

                "title": payload.title || "",
                "category": payload.category || "",
                "message": payload.message || "",
                "icon": payload.icon || "",
                "rule": payload.rule || "{}",
                "for_userid": payload.for_userid || "*",
                "seen_by": payload.seen_by || "",

                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });
        },

        async "logs.system"(payload, nodeId) {
            var dated = moment().format("Y-MM-DD HH:mm:ss");
            _DB.db_insertQ1("logdb", "log_system", {
                "appid": payload.appid || "-",
                "guid": payload.guid || "-",

                "level": payload.level || "info",
                "module": payload.module || "",
                "message": payload.message || "",
                "stack_trace": payload.stack_trace || "{}",
                "metadata": payload.metadata || "{}",
                "request_id": payload.request_id || "0",
                "trace_id": payload.trace_id || "0",
                "environment": process.env.NODE_ENV,
                
                "created_on": dated,
                "created_by": payload.userId || "-",
                "edited_on": dated,
                "edited_by": payload.userId || "-",
            });
        }
    }
}