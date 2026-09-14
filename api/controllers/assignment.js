/*
 * Policy Based Assignment Engine
 * policy-assignment
 * 
 * Domain model:
 *   Module   -> has many Tasks
 *   Task     -> has many Policies (ordered by `priority`, ascending = evaluated first)
 *   Policy   -> { conditions: [{attr, op, val}], logic: 'AND'|'OR', assignee }
 *
 * Resolution rule: first-match-wins, in priority order.
 * Swap `store` for a real repository (MySQL/Sequelize, Moleculer service call, etc.)
 * without touching the evaluation logic below — that's the whole point of keeping
 * evaluatePolicy/resolveAssignment pure functions.
 * 
 * Sample Store:
 * const store = {
  modules: [
    {
      id: 'm1',
      name: 'Procurement',
      tasks: [
        {
          id: 't1',
          name: 'Purchase Order Review',
          policies: [
            { id: 'p1', priority: 1, name: 'High-value · Mumbai', logic: 'AND',
              conditions: [{ attr: 'amount', op: '>', val: 5000 }, { attr: 'city', op: '==', val: 'Mumbai' }],
              assignee: 'Arun Deshmukh' },
            { id: 'p2', priority: 2, name: 'High-value · Delhi', logic: 'AND',
              conditions: [{ attr: 'amount', op: '>', val: 5000 }, { attr: 'city', op: '==', val: 'Delhi' }],
              assignee: 'Priya Nair' },
            { id: 'p3', priority: 3, name: 'Standard PO', logic: 'AND',
              conditions: [{ attr: 'amount', op: '<=', val: 5000 }],
              assignee: 'Sana Iqbal' }
          ]
        }
      ]
    }
  ]
};
 * */

const OPERATORS = new Set(['==', '!=', '>', '>=', '<', '<=', 'contains']);

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","Policy Based Assignment Engine Initialized");
        return true;
    },

    getAssignment: async function(guid, taskCode, payload = {}, ctx) {
        const userInfo = ctx?.meta?.user || {};
        const finalPayload = _.extend({}, payload, userInfo);

        const result = await _DB.db_selectQ("appdb", "lgks_assignments, lgks_assignments_policies", "*", {
            "lgks_assignments.guid": guid,
            "lgks_assignments.assignment_code": taskCode,
            "lgks_assignments.blocked": "false",
            "lgks_assignments_policies.blocked": "false",
            "lgks_assignments_policies.is_published": "true",
            "lgks_assignments_policies.effective_from<=NOW()": "RAW",
            "lgks_assignments.id=lgks_assignments_policies.assignments_id": "RAW",
        },{}, "ORDER BY lgks_assignments_policies.priority DESC");

        if(!result) return {"status": "failure", "message": "No assignment found for the given guid and taskCode"};

        const storeData = {};

        for (const row of result.results) {
            if (!storeData[row.assignment_code]) {
                storeData[row.assignment_code] = {
                    id: row.id,
                    guid: row.guid,
                    assignment_code: row.assignment_code,
                    title: row.title,
                    policies: []
                };
            }
            storeData[row.assignment_code].policies.push({
                id: row.policy_id,
                name: row.policy_name,
                logic: row.logic,
                priority: row.priority,
                conditions: row.conditions,//JSON.parse(),
                assignee: row.assignee
            });
        }

        const task = storeData[taskCode];
        if (!task) return {"status": "failure", "message": "No assignment found for the given taskCode"};

        return await this.processAssignment(task, finalPayload);
    },

    processAssignment: async function(taskJSON, payload = {}) {
        const assignmentResult = resolveAssignment(taskJSON, payload);

        return {
            status: "success",
            taskCode: taskJSON.assignment_code,
            payload: payload,
            // assignment: assignmentResult.assignee,
            // policy: assignmentResult.policy,
            // trace: assignmentResult.trace,
            assignment: assignmentResult
        };
    },

    validatePolicyShape: function(body) {
        const errors = [];
        if (!body.name) errors.push('name is required');
        if (!body.assignee) errors.push('assignee is required');
        if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
            errors.push('at least one condition is required');
        } else {
            body.conditions.forEach((c, i) => {
            if (!c.attr) errors.push(`conditions[${i}].attr is required`);
            if (!OPERATORS.has(c.op)) errors.push(`conditions[${i}].op is invalid`);
            if (c.val === undefined || c.val === '') errors.push(`conditions[${i}].val is required`);
            });
        }
        if (body.logic && !['AND', 'OR'].includes(body.logic)) errors.push('logic must be AND or OR');
        return errors;
    }
}


// ---------------------------------------------------------------------------
// Pure evaluation logic
// ---------------------------------------------------------------------------

/**
 * Evaluate a single condition against a supplied attribute bag.
 * @param {{attr:string, op:string, val:*}} condition
 * @param {Object} attributes  e.g. { amount: 7500, city: 'Mumbai' }
 * @returns {boolean}
 */
function evaluateCondition(condition, attributes) {
  const { attr, op, val } = condition;
  if (!OPERATORS.has(op)) {
    throw new Error(`Unsupported operator "${op}" in condition on "${attr}"`);
  }
  const raw = attributes[attr];
  if (raw === undefined || raw === null || raw === '') return false;

  const bothNumeric = !isNaN(parseFloat(val)) && !isNaN(parseFloat(raw));
  const a = bothNumeric ? parseFloat(raw) : String(raw).toLowerCase();
  const b = bothNumeric ? parseFloat(val) : String(val).toLowerCase();

  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case 'contains': return String(a).includes(String(b));
    default: return false;
  }
}

/**
 * Evaluate every condition on a policy and combine per its logic operator.
 * @param {Object} policy
 * @param {Object} attributes
 * @returns {boolean}
 */
function evaluatePolicy(policy, attributes) {
  if (!policy.conditions || policy.conditions.length === 0) return false;
  const results = policy.conditions.map((c) => evaluateCondition(c, attributes));
  return policy.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Resolve the assignee for a task instance: first policy (by ascending
 * priority) whose conditions are satisfied wins. Returns a full trace so the
 * UI (or an audit log) can show why a given person was chosen.
 * @param {Object} task    task record with a `policies` array
 * @param {Object} attributes
 * @returns {{assignee:string|null, policy:Object|null, trace:Array<Object>}}
 */
function resolveAssignment(task, attributes) {
  const ordered = [...task.policies].sort((a, b) => a.priority - b.priority);
  const trace = [];
  let winner = null;

  for (const policy of ordered) {
    const matched = evaluatePolicy(policy, attributes);
    trace.push({ policyId: policy.id, name: policy.name, priority: policy.priority, matched });
    if (matched && !winner) winner = policy;
  }

  return {
    assignee: winner ? winner.assignee : null,
    policy: winner ? { id: winner.id, name: winner.name, priority: winner.priority } : null,
    trace
  };
}

