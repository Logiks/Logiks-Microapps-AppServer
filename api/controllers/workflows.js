/*
 * Workflow Controller for Application
 * 
 * 
 * Tables
 * sys_workflows                    > primary workflow table
 * sys_workflows_history            > all published history of workflows
 * sys_workflows_stages             > all stages of workflows
 * sys_workflows_transitions        > all transitions of workflows
 * sys_workflows_wflows             > Runtime table
 * */

const NOT_SET = '-';
const isSet = (v) => v !== null && v !== undefined && v !== '' && v !== NOT_SET;

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","Workflow Controller Initialized");
        return true;
    },

    //On creation of a new data record that needs to be processed through a workflow, this function will create a new workflow instance for the data record and return the workflow instance id.
    //Need to be handled with dbops
    createWorkflow: async function(ctx, workflowCode, dataRefId, dataPayload, startFlow = false) {
        if(!dataRefId) return {status: "error", "message": "dataRefId not defined"}
        if(!workflowCode) return {status: "error", "message": "workflowCode not defined"}

        const workflowData = await _DB.db_selectQ("appdb", "sys_workflows", "*", {
            "guid": ctx.meta.user.guid,
            "workflow_code": workflowCode,
            "status": "published",
            "blocked": "false",
        });
        if(!workflowData || !workflowData?.results || workflowData.results.length<=0) return {status: "error", "message": "Workflow not found"}

        const workflow = workflowData.results[0];
        // console.log(">>>>>", workflow);

        if(!workflow.rules_json) {
            workflow.rules_json = this.compileRule(workflowCode);
        }

        const jsonRule = workflow.rules_json;

        const approvalHistory = {"start": {}};
        approvalHistory.start[ctx.meta.user.userId] = moment().format("Y-M-D HH:mm:ss");


        const response = await _DB.db_insertQ1("appdb", "sys_workflows_wflows", _.extend({
            data_refid: dataRefId, 
            workflow_code: workflowCode, 
            vers: workflow.vers,
            current_stage: "start", 
            current_assigned_to: ctx.meta.user.userId, 
            last_updated_on: moment().format("Y-M-D HH:mm:ss"),
            last_updated_by: ctx.meta.user.userId, 
            last_updated_stage: "start", 
            rules_json: jsonRule,
            approval_history: approvalHistory
        }, MISC.generateDefaultDBRecord(ctx)));
        // console.log(">>>>", response);

        if(response.status=="success") {
            const wflowId = response.insertId;

            if(startFlow) {
                const nextStep = this.getNextStep(ctx, wflowId, dataRefId, dataPayload);

                return {
                    "status": "success",
                    "next": nextStep,
                    "wflowId": wflowId
                };
            } else {
                return {
                    "status": "success",
                    "wflowId": wflowId
                };
            }
        } else {
            if(response.err_code=="ER_DUP_ENTRY") {
                const response = await _DB.db_selectQ("appdb", "sys_workflows_wflows", "*", {
                    guid: ctx.meta.user.guid,
                    data_refid: dataRefId, 
                    workflow_code: workflowCode, 
                    vers: workflow.vers,
                    rejected: 'false',
                    blocked: 'false'
                }, {});
                if(response.results && response.results.length==1) {
                    const wflowId = response.results[0].id;
                    if(startFlow) {
                        const nextStep = this.getNextStep(ctx, wflowId, dataRefId, dataPayload);

                        return {
                            "status": "success",
                            "next": nextStep,
                            "wflowId": wflowId
                        };
                    } else {
                        return {
                            "status": "success",
                            "wflowId": wflowId
                        };
                    }
                }
            }
            return {status: "error", "message": "Error creating worklow", "data": response}
        }
    },

    //Run a workflow rule for a given workflow instance and data record. This function will be called when a data record is created or updated, and it will check the workflow rules and execute the appropriate actions.
    getNextStep: async function(ctx, wflowId, dataRefId, dataPayload) {
        const workflowData = await _DB.db_selectQ("appdb", "sys_workflows_wflows", "*", {
                    guid: ctx?.meta?.user?.guid,
                    id: wflowId,
                    data_refid: dataRefId, 
                    rejected: "false",
                    blocked: 'false'
                }, {});
        if(!workflowData || workflowData.results.length<=0) return {status: "error", message: "Workflow Log Not Found (wflows-1)"}

        const workflowCode = workflowData.results[0].workflow_code;
        const workflowRule = workflowData.results[0].rules_json;
        const currentStage = workflowData.results[0].current_stage;
        const currentAssignee = workflowData.results[0].current_assigned_to;
        const currentApprovers = workflowData.results[0].current_approvers;
        const approvalHistory = workflowData.results[0].approval_history || {};

        // workflowData.results[0].last_updated_on
        // workflowData.results[0].last_updated_by
        // workflowData.results[0].last_updated_stage

        const nextStep = resolveNextStep(workflowRule, currentStage, currentAssignee, approvalHistory, dataPayload);
        nextStep.next_assignee = "-";

        // console.log(">>>>>>>>getNextStep", wflowId, dataRefId, dataPayload, currentStage, currentAssignee, approvalHistory, JSON.stringify(nextStep, null, 2));

        if(nextStep.next_stage && workflowRule.stages[nextStep.next_stage]) {
            nextStep.next_assignee = workflowRule.stages[nextStep.next_stage].assigned_to;

            if(nextStep.next_assignee.substr(0,1)=="@") {
                nextStep.next_assignee = ASSIGNMENT.getAssignment(ctx.meta.user.guid, nextStep.next_assignee, dataPayload);
            }

            // console.log(">>>>>>>>getNextStep2", wflowId, dataRefId, dataPayload, currentStage, currentAssignee, approvalHistory, JSON.stringify(nextStep, null, 2), JSON.stringify(workflowRule, null, 2));

            await _DB.db_updateQ("appdb", "sys_workflows_wflows", {
                // "approval_history": approval_history,
                "last_updated_on": moment().format("Y-M-D HH:mm:ss"),
                "last_updated_by": ctx?.meta?.user?.userId,
                "last_updated_stage": currentStage,
                "current_stage": nextStep.next_stage,
                "current_assigned_to": nextStep.next_assignee,
                "current_approvers": "",
                
                "edited_on": moment().format("Y-M-D HH:mm:ss"),
            }, {
                "id": wflowId,
                "blocked": false,
            });

            return nextStep;
        } else if(nextStep.status=="WAITING" && nextStep.approved_count<nextStep.required_approvals) {
            return {status: "waiting", message: "Required Approvals is not achived", current_stage: currentStage, approved_count: nextStep.approved_count, required_approvals: nextStep.required_approvals, required: workflowData.results[0].current_assigned_to.split(",").filter(a=>a.length>0), approved: workflowData.results[0].current_approvers.split(",").filter(a=>a.length>0)}
        } else if(nextStep.status=="COMPLETED") {
            if(!approvalHistory.completed) {
                approvalHistory["completed"] = {"index": Object.keys(approvalHistory).length};
                approvalHistory["completed"][workflowData.results[0].last_updated_by] = workflowData.results[0].last_updated_on;

                await _DB.db_updateQ("appdb", "sys_workflows_wflows", {
                    "approval_history": approvalHistory,
                    "edited_on": moment().format("Y-M-D HH:mm:ss"),
                }, {
                    "id": wflowId,
                    "blocked": false,
                    "current_stage<>'completed'": "RAW"
                });
            }

            return {status: "completed", message: "This flow is completed",  approvalHistory};
        } else {
            return {status: "error", message: "Workflow Configuration Error, can not move to next step", current_stage: currentStage}
        }
    },

    approveFlow: async function(ctx, wflowId, dataRefId, approver, dataPayload = {}) {
        if(!approver) approver = ctx?.meta?.user?.userId;

        const workflowData = await _DB.db_selectQ("appdb", "sys_workflows_wflows", "*", {
                    guid: ctx?.meta?.user?.guid,
                    id: wflowId,
                    data_refid: dataRefId, 
                    rejected: 'false',
                    blocked: 'false'
                }, {});
        if(!workflowData || workflowData.results.length<=0) return {status: "error", message: "Workflow Log Not Found (wflows-1)"}

        // const workflowCode = workflowData.results[0].workflow_code;
        // const workflowRule = workflowData.results[0].rules_json;
        const currentStage = workflowData.results[0].current_stage;
        const currentAssignee = workflowData.results[0].current_assigned_to;
        let currentApprovers = workflowData.results[0].current_approvers;
        const approvalHistory = workflowData.results[0].approval_history || {};

        if(!approvalHistory[currentStage]) approvalHistory[currentStage] = {"index": Object.keys(approvalHistory).length};

        if(currentAssignee.split(",").indexOf(approver)<0) return {status: "error", message: "Approver not allowe to approve this stage", required: currentAssignee.split(","), approvers: currentApprovers.split(",")}
        if(currentApprovers.split(",").indexOf(approver)>=0) return {status: "error", message: "Already approved by given user", required: currentAssignee.split(","), approvers: currentApprovers.split(",")}

        if(!currentApprovers) currentApprovers = [];
        else currentApprovers = currentApprovers.split(",");
        
        approvalHistory[currentStage][approver] = moment().format("Y-M-D HH:mm:ss");
        currentApprovers.push(approver);

        await _DB.db_updateQ("appdb", "sys_workflows_wflows", {
                "approval_history": approvalHistory,
                "last_updated_on": moment().format("Y-M-D HH:mm:ss"),
                "last_updated_by": approver || ctx?.meta?.user?.userId,
                // "last_updated_stage": currentStage,
                // "current_stage": nextStep.next_stage,
                "current_approvers": currentApprovers.join(","),
                
                "edited_on": moment().format("Y-M-D HH:mm:ss"),
            }, {
                "id": wflowId,
                "blocked": false,
            });
        
        return {"status": "success", approver, wflowId, dataRefId}
    },

    rejectFlow: async function(ctx, wflowId, dataRefId, rejectedBy) {
        await _DB.db_updateQ("appdb", "sys_workflows_wflows", {
                "last_rejected_by": rejectedBy || ctx?.meta?.user?.userId,
                "last_updated_on": moment().format("Y-M-D HH:mm:ss"),
                "edited_on": moment().format("Y-M-D HH:mm:ss"),
                "rejected": true,
            }, {
                "guid": ctx?.meta?.user?.guid,
                "id": wflowId,
                "blocked": false,
                "current_stage<>'completed'": "RAW"
            });
        return {"status": "success", rejectedBy, wflowId, dataRefId}
    },

    validateTransition: async function(ctx, wflowId, dataRefId, dataPayload) {
        const workflowData = await _DB.db_selectQ("appdb", "sys_workflows_wflows", "*", {
                    id: wflowId,
                    data_refid: dataRefId, 
                    rejected: "false",
                    blocked: 'false'
                }, {});
        if(!workflowData || workflowData.results.length<=0) return {status: "error", message: "Workflow Log Not Found (wflows-1)"}

        const workflowCode = workflowData.results[0].workflow_code;
        const workflowRule = workflowData.results[0].rules_json;
        const currentStage = workflowData.results[0].current_stage;
        const currentAssignee = workflowData.results[0].current_assigned_to;
        const currentApprovers = workflowData.results[0].current_approvers;
        const approvalHistory = workflowData.results[0].approval_history || {};

        const nextStep = resolveNextStep(workflowRule, currentStage, currentAssignee, approvalHistory, dataPayload);
        nextStep.next_assignee = "-";

        // console.log(">>>>>>>>getNextStep", wflowId, dataRefId, dataPayload, currentStage, currentAssignee, approvalHistory, JSON.stringify(nextStep, null, 2));

        if(nextStep.next_stage && workflowRule.stages[nextStep.next_stage]) {
            nextStep.next_assignee = workflowRule.stages[nextStep.next_stage].assigned_to;

            if(nextStep.next_assignee.substr(0,1)=="@") {
                nextStep.next_assignee = ASSIGNMENT.getAssignment(ctx.meta.user.guid, nextStep.next_assignee, dataPayload);
            }

            return nextStep;
        } else {
            return {status: "error", message: "Workflow Configuration Error, can not move to next step"}
        }
    },

    getApprovalHistory: async function(wflowId) {
        const workflowData = await _DB.db_selectQ("appdb", "sys_workflows_wflows", "*", {
                    id: wflowId,
                }, {});
        if(!workflowData || workflowData.results.length<=0) return {status: "error", message: "Workflow Log Not Found (wflows-1)"}

        const approvalHistory = workflowData.results[0].approval_history || {};

        return {status: "success", history: approvalHistory, wflowId}
    },

    compileRule: async function(workflowCode) {
        const jsonRule = await buildWorkflowDefinition(workflowCode);
        // console.log(">jsonRule", JSON.stringify(jsonRule, null, 2));
        _DB.db_updateQ("appdb", "sys_workflows", {
                    "rules_json": jsonRule,
                    "edited_on": moment().format("Y-M-D HH:mm:ss"),
                }, {
                    workflow_code: workflowCode
                });
        return jsonRule;
    },

    publishRule: async function(ctx, workflowCode) {
        const response = this.compileRule(workflowCode);
        if(response) {
            return await _DB.db_updateQ("appdb", "sys_workflows", {
                    "status": "published",
                    "edited_on": moment().format("Y-M-D HH:mm:ss"),
                    "edited_by": ctx.meta.user.userId
                }, {
                    workflow_code: workflowData[0].workflowCode
                });
        } else {
            return false;
        }
    }
}

/**
 * Assembles the nested workflow-definition JSON (the { stages: {...} } shape)
 * from the three flat tables: sys_workflows, sys_workflows_stages,
 * sys_workflows_transitions.
 *
 * Mapping, corrected against real data (v2):
 *
 *  - sys_workflows_transitions.rules stores an ARRAY of one or more full
 *    rule objects, each already containing next/rejected inline:
 *        [{ match?, when, next, rejected? }, ...]
 *    to_stage/on_reject are denormalized copies of the first item's
 *    next/rejected (handy for indexed lookups without parsing JSON) — the
 *    array is the source of truth, so each item is used as-is; to_stage/
 *    on_reject are only used as a *fallback* when an item is missing that
 *    field, never merged on top of what the item already has.
 *  - "-" is this schema's "not set" sentinel wherever a column has no
 *    dedicated NULL default (assigned_to here, on_reject elsewhere) — both
 *    are treated as absent, not as literal values to emit.
 *  - required_approvals is omitted whenever a stage has no outgoing
 *    transitions (i.e. it's a terminal node), rather than keying off a
 *    specific stage_type string like 'stop' — terminal-type naming varies
 *    (this schema currently uses 'final'), so the actual shape of the graph
 *    (no rules -> no required_approvals) is used instead.
 *  - Row order isn't guaranteed by the DB layer regardless of an ORDER BY
 *    hint, so stage/transition rows are explicitly sorted by `id` in JS
 *    after fetching, rather than trusted from the query.
 *
 * Uses the same _DB.db_selectQ(dbName, table, cols, where, opts, extraSql)
 * helper used elsewhere in the Logiks Framework services.
 *
 * @param {string} workflowCode
 * @param {object} [opts]
 * @param {string} [opts.dbName='appdb']
 * @param {boolean} [opts.includeBlocked=false] include blocked stages/transitions
 * @returns {Promise<{stages: object}>}
 */
async function buildWorkflowDefinition(workflowCode, opts = {}, dbName = 'appdb') {
    const includeBlocked = !!opts.includeBlocked;

    if (!workflowCode) {
        throw new Error('workflowCode is required');
    }

    // 1. Confirm the workflow exists (and isn't blocked) before doing any
    //    further work — fail fast with a clear error rather than quietly
    //    returning an empty { stages: {} }.
    const wfRes = await _DB.db_selectQ(dbName, 'sys_workflows', '*', {
        workflow_code: workflowCode,
    }, {});
    const workflow = wfRes && wfRes.results && wfRes.results[0];
    if (!workflow) {
        throw new Error(`Workflow not found: ${workflowCode}`);
    }
    if (!includeBlocked && workflow.blocked === 'true') {
        throw new Error(`Workflow is blocked: ${workflowCode}`);
    }

    // 2. Stages
    const stageFilter = { workflow_code: workflowCode };
    if (!includeBlocked) stageFilter.blocked = 'false';
    const stagesRes = await _DB.db_selectQ(dbName, 'sys_workflows_stages', '*', stageFilter, {}, 'ORDER BY priority ASC, id ASC');
    const stageRows = ((stagesRes && stagesRes.results) || []).slice()
        .sort((a, b) => (a.priority - b.priority) || (a.id - b.id));

    // 3. Transitions
    const transitionFilter = { workflow_code: workflowCode };
    if (!includeBlocked) transitionFilter.blocked = 'false';
    const transitionsRes = await _DB.db_selectQ(dbName, 'sys_workflows_transitions', '*', transitionFilter, {}, 'ORDER BY id ASC');
    // Don't trust the DB layer's ORDER BY to actually be honored —
    // sort explicitly by id so rule/child_node order is deterministic
    // regardless of what the underlying driver does with that hint.
    const transitionRows = ((transitionsRes && transitionsRes.results) || []).slice()
        .sort((a, b) => a.id - b.id);

    // Group transitions by their source stage.
    const transitionsByStage = {};
    transitionRows.forEach((t) => {
        if (!t.from_stage) return; // defensive: skip malformed rows
        if (!transitionsByStage[t.from_stage]) transitionsByStage[t.from_stage] = [];
        transitionsByStage[t.from_stage].push(t);
    });

    // 4. Assemble
    const stages = {};

    stageRows.forEach((stage) => {
        const code = stage.stage_code;
        if (!code) return; // defensive: skip malformed rows

        const node = { type: stage.stage_type };
        // if (isSet(stage.assigned_to)) {
        //     node.assigned_to = stage.assigned_to;
        // }
        if(node.type!="decision") node.assigned_to = stage.assigned_to;

        const myTransitions = transitionsByStage[code] || [];

        if (myTransitions.length > 0 && isSet(stage.required_approvals) ) {
            node.required_approvals = stage.required_approvals;
        }
        // required_approvals intentionally omitted for terminal stages
        // (no outgoing transitions) regardless of stage_type's label.

        if (myTransitions.length > 0) {
            const rules = [];
            const childNodes = [];

            myTransitions.forEach((t) => {
                let parsed = t.rules;
                if (typeof parsed === 'string') {
                    try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
                }
                // rules is an array of one or more complete rule objects;
                // tolerate a bare object too, for rows saved before this
                // convention or written by hand.
                var items = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);

                if (items.length === 0) {
                    // No JSON payload on this row — fall back to building
                    // a rule purely from the flat columns.
                    //items.push();
                    items = "*";
                }

                const rule = {};
                rule.when = items;
                rule.match = t.rule_match;

                if (rule.next === undefined && t.to_stage) rule.next = t.to_stage;
                if (rule.rejected === undefined && isSet(t.on_reject)) rule.rejected = t.on_reject;

                rules.push(rule);
                if (rule.next && !childNodes.includes(rule.next)) {
                    childNodes.push(rule.next);
                }
            });

            node.rules = rules;
            node.child_nodes = childNodes;
        }

        stages[code] = node;
    });

    return { stages };
}

function resolveNextStep(
    workflowObj,
    currentStage,
    currentAssignee,
    approvalHistory = {},
    record = {}
) {
    if (!workflowObj || !workflowObj.stages) {
        throw new Error("Invalid workflow object");
    }

    if (!currentStage) {
        throw new Error("Current stage is required");
    }

    const stage = workflowObj.stages[currentStage];

    if (!stage) {
        throw new Error(
            `Workflow stage '${currentStage}' not found`
        );
    }

    const stageType = stage.type || "approval";

    const context = {
        record
    };

    /*
     * =========================================================
     * STOP
     * =========================================================
     */
    if (stageType === "stop" || stageType === "final") {
        return {
            status: "COMPLETED",
            current_stage: currentStage,
            next_stage: null
        };
    }

    /*
     * =========================================================
     * DECISION
     *
     * Decision stages do not require approval.
     * Evaluate rules immediately.
     * =========================================================
     */
    if (stageType === "decision") {
        const matchedRule = findMatchingRule(
            stage.rules || [],
            context
        );

        if (!matchedRule) {
            return {
                status: "NO_MATCH",
                current_stage: currentStage,
                next_stage: null,
                message: "No matching transition rule found"
            };
        }

        return {
            status: "NEXT",
            current_stage: currentStage,
            next_stage: matchedRule.next,
            rule: matchedRule
        };
    }

    /*
     * =========================================================
     * APPROVAL
     * =========================================================
     */
    if (stageType === "approval") {

        const requiredApprovals = Math.max(
            1,
            Number(stage.required_approvals || 1)
        );

        /*
         * Normalize assignees.
         *
         * Examples:
         *
         * "user1"
         *
         * ["user1", "user2", "user3"]
         */
        const assignees = normalizeUsers(
            currentAssignee
        );

        /*
         * Normalize approvals for current stage.
         *
         * Examples:
         *
         * {
         *     manager: ["user1", "user2"]
         * }
         *
         * or
         *
         * {
         *     manager: "user1"
         * }
         */
        const approvals = normalizeUsers(
            approvalHistory[currentStage]
        );

        /*
         * Only approvals from currently assigned users
         * are considered valid.
         *
         * If no assignee is supplied, we don't filter.
         */
        const validApprovals =
            assignees.length > 0
                ? approvals.filter(userId =>
                    assignees.includes(userId)
                )
                : approvals;

        const approvedCount = validApprovals.length;

        /*
         * =====================================================
         * WAITING FOR APPROVAL
         * =====================================================
         */
        if (approvedCount < requiredApprovals) {

            const pendingAssignees =
                assignees.filter(
                    userId =>
                        !validApprovals.includes(userId)
                );

            return {
                status: "WAITING",
                current_stage: currentStage,
                next_stage: null,

                required_approvals:
                    requiredApprovals,

                approved_count:
                    approvedCount,

                pending_approvals:
                    requiredApprovals - approvedCount,

                assignees,

                approved_by:
                    validApprovals,

                pending_assignees:
                    pendingAssignees
            };
        }

        /*
         * =====================================================
         * APPROVAL REQUIREMENT SATISFIED
         *
         * Now evaluate transition rules.
         * =====================================================
         */
        const matchedRule = findMatchingRule(
            stage.rules || [],
            context
        );

        if (!matchedRule) {
            return {
                status: "NO_MATCH",
                current_stage: currentStage,
                next_stage: null,

                required_approvals:
                    requiredApprovals,

                approved_count:
                    approvedCount,

                approved_by:
                    validApprovals,

                message:
                    "Approval requirement satisfied but no matching transition rule found"
            };
        }

        /*
         * =====================================================
         * NEXT STAGE
         * =====================================================
         */
        return {
            status: "NEXT",

            current_stage:
                currentStage,

            next_stage:
                matchedRule.next,

            required_approvals:
                requiredApprovals,

            approved_count:
                approvedCount,

            approved_by:
                validApprovals,

            rule:
                matchedRule
        };
    }

    /*
     * =========================================================
     * UNKNOWN STAGE TYPE
     * =========================================================
     */
    throw new Error(
        `Unsupported workflow stage type '${stageType}'`
    );
}


/*
 * =============================================================
 * Find matching rule
 *
 * Rule order is significant.
 * First matching rule wins.
 * =============================================================
 */
function findMatchingRule(rules, context) {

    if (!Array.isArray(rules)) {
        return null;
    }

    for (const rule of rules) {

        if (!rule) {
            continue;
        }

        /*
         * Wildcard
         *
         * {
         *     "when": "*",
         *     "next": "senior"
         * }
         */
        if (rule.when === "*") {
            return rule;
        }

        if (!Array.isArray(rule.when)) {
            continue;
        }

        const matchType =
            String(
                rule.match || "AND"
            ).toUpperCase();

        const results =
            rule.when.map(condition =>
                evaluateCondition(
                    condition,
                    context
                )
            );

        let matched = false;

        if (matchType === "OR") {
            matched = results.some(Boolean);
        }
        else {
            matched = results.every(Boolean);
        }

        if (matched) {
            return rule;
        }
    }

    return null;
}


/*
 * =============================================================
 * Evaluate a single condition
 *
 * Example:
 *
 * {
 *     "attr": "record.amount",
 *     "op": "<",
 *     "value": 100000
 * }
 * =============================================================
 */
function evaluateCondition(condition, context) {

    if (!condition) {
        return false;
    }

    const actualValue = getValue(
        context,
        condition.attr
    );

    const expectedValue = condition.value;

    const op = String(
        condition.op || "=="
    ).toUpperCase();

    /*
     * Missing/null value handling
     *
     * IMPORTANT:
     * A missing attribute should not accidentally
     * satisfy comparison rules.
     */
    const isMissing =
        actualValue === undefined ||
        actualValue === null;

    switch (op) {

        /*
         * =====================================================
         * EXISTENCE
         * =====================================================
         */

        case "EXISTS":
            return !isMissing;

        case "NOT_EXISTS":
            return isMissing;


        /*
         * =====================================================
         * EMPTY
         * =====================================================
         */

        case "EMPTY":

            return (
                isMissing ||
                actualValue === "" ||
                (
                    Array.isArray(actualValue) &&
                    actualValue.length === 0
                )
            );


        case "NOT_EMPTY":

            return !(
                isMissing ||
                actualValue === "" ||
                (
                    Array.isArray(actualValue) &&
                    actualValue.length === 0
                )
            );


        /*
         * =====================================================
         * Missing value
         *
         * All normal comparisons return false.
         * =====================================================
         */

        case "=":
        case "==":
        case "===":
        case "!=":
        case "!==":
        case ">":
        case ">=":
        case "<":
        case "<=":
        case "IN":
        case "NOT_IN":
        case "CONTAINS":
        case "NOT_CONTAINS":

            if (isMissing) {
                return false;
            }

            break;


        default:

            throw new Error(
                `Unsupported rule operator '${condition.op}'`
            );
    }


    /*
     * =====================================================
     * Normal comparisons
     * =====================================================
     */

    switch (op) {

        case "=":
        case "==":
        case "===":
            return actualValue === expectedValue;


        case "!=":
        case "!==":
            return actualValue !== expectedValue;


        case ">":
            return actualValue > expectedValue;


        case ">=":
            return actualValue >= expectedValue;


        case "<":
            return actualValue < expectedValue;


        case "<=":
            return actualValue <= expectedValue;


        case "IN":

            return (
                Array.isArray(expectedValue) &&
                expectedValue.includes(actualValue)
            );


        case "NOT_IN":

            return (
                Array.isArray(expectedValue) &&
                !expectedValue.includes(actualValue)
            );


        case "CONTAINS":

            if (Array.isArray(actualValue)) {
                return actualValue.includes(
                    expectedValue
                );
            }

            if (typeof actualValue === "string") {
                return actualValue.includes(
                    String(expectedValue)
                );
            }

            return false;


        case "NOT_CONTAINS":

            if (Array.isArray(actualValue)) {
                return !actualValue.includes(
                    expectedValue
                );
            }

            if (typeof actualValue === "string") {
                return !actualValue.includes(
                    String(expectedValue)
                );
            }

            return false;


        default:

            throw new Error(
                `Unsupported rule operator '${condition.op}'`
            );
    }
}

/*
 * =============================================================
 * Get nested property
 *
 * Example:
 *
 * getValue(
 *     { record: { customer: { amount: 5000 } } },
 *     "record.customer.amount"
 * )
 *
 * => 5000
 * =============================================================
 */
function getValue(obj, path) {

    if (!path) {
        return undefined;
    }

    return String(path)
        .split(".")
        .reduce(
            (value, key) => {

                if (
                    value === undefined ||
                    value === null
                ) {
                    return undefined;
                }

                return value[key];
            },
            obj
        );
}


/*
 * =============================================================
 * Normalize users
 *
 * "user1"
 * =>
 * ["user1"]
 *
 * ["user1", "user2"]
 * =>
 * ["user1", "user2"]
 *
 * null / undefined
 * =>
 * []
 * =============================================================
 */
function normalizeUsers(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return [];
    }

     /*
     * Array
     *
     * ["user1", "user2"]
     */
    if (Array.isArray(value)) {

        return [
            ...new Set(
                value
                    .filter(
                        userId =>
                            userId !== undefined &&
                            userId !== null &&
                            userId !== ""
                    )
                    .map(String)
            )
        ];
    }

    /*
     * Object
     *
     * {
     *     "user1": "2026-09-20T10:00:00",
     *     "user2": "2026-09-20T10:05:00"
     * }
     *
     * Return the object keys.
     */
    if (
        typeof value === "object"
    ) {

        return [
            ...new Set(
                Object.keys(value)
                    .filter(
                        userId =>
                            userId !== undefined &&
                            userId !== null &&
                            userId !== ""
                    )
                    .map(String)
            )
        ];
    }

    if(String(value).indexOf(",")>0) return String(value).split(",");
    return [String(value)];
}