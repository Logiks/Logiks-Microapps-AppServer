/*
 * ABAC Controller for Application and Users
 * Attribute-Based Access Control — Policy Decision Point (PDP)
 *
 * This is access control, not task routing: given a request describing
 * {subject, resource, action, environment} attributes, it answers
 * Permit / Deny / NotApplicable / Indeterminate — XACML-style, simplified.
 *
 * Hierarchy:
 *   PolicySet (the whole engine call)
 *     -> Policy   { target?, ruleCombiningAlgorithm, rules[] }
 *          -> Rule { effect: 'Permit'|'Deny', target[], targetLogic }
 *
 * A condition's `value` may reference another attribute dynamically by
 * prefixing with "$", e.g. { attr:'resource.ownerId', op:'==', value:'$subject.id' }
 * — lets you express "user can edit own record" without hardcoding an id.
 * 
 * Sample Stored Policy:
 * 
 * const store = {
  policies: [
    {
      id: 'pol_doc_access',
      name: 'Document access control',
      ruleCombiningAlgorithm: 'deny-overrides',
      target: [{ attr: 'resource.type', op: '==', value: 'document' }],
      rules: [
        {
          id: 'r1',
          effect: 'Deny',
          description: 'No access outside business hours unless role is Admin',
          target: [
            { attr: 'environment.hour', op: '<', value: 9 },
            { attr: 'subject.role', op: '!=', value: 'Admin' }
          ],
          targetLogic: 'AND'
        },
        {
          id: 'r2',
          effect: 'Permit',
          description: 'Owner can always access their own document',
          target: [{ attr: 'resource.ownerId', op: '==', value: '$subject.id' }],
          targetLogic: 'AND'
        },
        {
          id: 'r3',
          effect: 'Permit',
          description: 'Same-department read access',
          target: [
            { attr: 'action.name', op: '==', value: 'read' },
            { attr: 'subject.department', op: '==', value: '$resource.department' }
          ],
          targetLogic: 'AND'
        }
      ]
    },
    {
      id: 'pol_loan_file',
      name: 'Loan file clearance',
      ruleCombiningAlgorithm: 'first-applicable',
      target: [{ attr: 'resource.type', op: '==', value: 'loan_file' }],
      rules: [
        {
          id: 'r4',
          effect: 'Deny',
          description: 'Sensitivity above clearance is always denied first',
          target: [{ attr: 'subject.clearanceLevel', op: '<', value: '$resource.sensitivityLevel' }],
          targetLogic: 'AND'
        },
        {
          id: 'r5',
          effect: 'Permit',
          description: 'Underwriters with sufficient clearance may access',
          target: [{ attr: 'subject.role', op: '==', value: 'Underwriter' }],
          targetLogic: 'AND'
        }
      ]
    }
  ]
};
 */

// const ABAC_CACHE = _CACHE.getCacheMap("ABACCACHE");

const OPERATORS = new Set(['==', '!=', '>', '>=', '<', '<=', 'contains', 'in']);
const RULE_ALGORITHMS = new Set(['deny-overrides', 'permit-overrides', 'first-applicable']);
const EFFECTS = new Set(['Permit', 'Deny']);

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","ABAC scopes, policies and access Initialized");
        return true;
    },

    filterResults: async function(ctx, data, subject, action, environment, options = {}, defaultValue = "Deny", debug = false) {
        if(!data || !Array.isArray(data)) return false;

        if(!subject) subject = ctx?.meta?.user || {};
        if(typeof action == "string") action = { "name": action };

        environment = await this.getEnvironment(ctx, environment);

        const policies = await this.getPolicyObject(ctx?.meta?.user?.guid, policyArr);

        if(!policies) return {
            "decision": defaultValue,
            "defaulted": true,
            "message": "No policies found for the given policies"
        }

        // console.log(">>> ABAC Policies Loaded", JSON.stringify(policies, null, 2));

        for(var i=0; i<data.length; i++) {
            const resource = data[i];
            const request = { subject, resource, action, environment: environment || {} };

            const result = decide(request, policies, options);
            data[i].abac_decision = result.decision;
            data[i].abac_policies = result.policies;
            data[i].abac_policies_defaulted = result.defaulted;
        }

        return data;
    },

    checkPolicy: async function(ctx, policyArr, resource, action = 'access', environment, options = {}, defaultValue = "Deny", debug = false) {
        const subject = ctx?.meta?.user || {};
        if(typeof action == "string") action = { "name": action };

        environment = await this.getEnvironment(ctx, environment);

        const policies = await this.getPolicyObject(ctx?.meta?.user?.guid, policyArr);

        if(!policies) return {
            "decision": defaultValue,
            "defaulted": true,
            "message": "No policies found for the given policies"
        }

        // console.log(">>> ABAC Policies Loaded", JSON.stringify(policies, null, 2), subject, resource, action, environment, debug);

        const request = { subject, resource, action, environment: environment || {} };

        return decide(request, policies, options, debug);
    },

    processPolicy: async function(ctx, policyArr, subject = null, resource, action = 'access', environment = {}, options = {}, defaultValue = "Deny", debug = false) {
        if(!resource) return {
            "decision": defaultValue,
		    "defaulted": true,
            "message": "Resource is required"
        }

        if(!subject) subject = ctx?.meta?.user || {};
        if(typeof action == "string") action = { "name": action };

        environment = await this.getEnvironment(ctx, environment);

        const policies = await this.getPolicyObject(ctx?.meta?.user?.guid, policyArr);

        if(!policies) return {
            "decision": defaultValue,
            "defaulted": true,
            "message": "No policies found for the given policies"
        }

        console.log(">>> ABAC Policies Loaded", JSON.stringify(policies, null, 2));

        const request = { subject, resource, action, environment: environment || {} };

        return decide(request, policies, options, debug);
    },

    decidePolicy: async function(subject, resource, action, environment, options, debug = false) {
        if (!subject || !resource || !action) {
            return false;
        }

        const request = { subject, resource, action, environment: environment || {} };

        return decide(request, store.policies, options || {}, debug);
        
    },

    getPolicyObject: async function(guid, policyArr) {
        if(!Array.isArray(policyArr)) policyArr = [policyArr];

        const policyData = await _DB.db_selectQ("appdb", "lgks_abacpolicies,lgks_abacpolicies_rules", "*, lgks_abacpolicies_rules.id as rule_id", {
            "lgks_abacpolicies.guid": guid || "global",
            "lgks_abacpolicies.blocked": "false",
            "lgks_abacpolicies_rules.blocked": "false",
            "lgks_abacpolicies.policystr": [policyArr, "IN"],
            "lgks_abacpolicies.id=lgks_abacpolicies_rules.abacpolicies_id": "RAW"
        }, {}, "ORDER BY lgks_abacpolicies_rules.priority DESC");

        if(!policyData || !policyData.results || policyData.results.length == 0) return null;

        const policies = {};
        for(var i=0; i<policyData.results.length; i++) {

            const row = Object.fromEntries(
                    Object.entries(policyData.results[i]).map(([key, value]) => [
                            key.split('.')[1],
                            value
                        ])
                );

            if(!policies[row.policystr]) policies[row.policystr] = {
                id: row.policystr,
                refid: row.id,
                name: row.name,
                ruleCombiningAlgorithm: row.rule_combining_algorithm || "deny-overrides",
                target: row.rule_target || "[]",
                defaultEffect: row.default_effect || "Deny",
                targetLogic: row.default_target_logic || "AND",
                rules: []
            };

            policies[row.policystr].rules.push({
                id: row.rule_id,
                effect: row.effect,
                description: row.description,
                target: row.target || "[]",
                targetLogic: row.target_logic || "AND",
                priority: row.priority,
            });
        }

        return Object.values(policies);//.sort((a, b) => a.priority - b.priority);
    },

    getEnvironment: async function(ctx, environment = {}) {
        const env = await ENV.fetchEnvByNature(ctx, "backend");
        const envInfo = await ENV.fetchEnvInfo(ctx.meta);

        return _.extend(envInfo, env, environment || { 
            "timestamp": new Date(),
            "hour": new Date().getHours(), 
         });
    }
}

// ---------------------------------------------------------------------------
// Attribute resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted path like "subject.department" against the request bag.
 */
function getAttr(request, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), request);
}

/**
 * A condition's `value` is either a literal, or a "$subject.x" style
 * reference resolved dynamically against the same request.
 */
function resolveValue(request, value) {
  if (typeof value === 'string' && value.startsWith('$')) {
    return getAttr(request, value.slice(1));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Condition / target evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(condition, request) {
  const { attr, op } = condition;
  if (!OPERATORS.has(op)) throw new Error(`Unsupported operator "${op}" on "${attr}"`);

  const raw = getAttr(request, attr);
  const target = resolveValue(request, condition.value);
  if (raw === undefined || raw === null || target === undefined || target === null) return false;

  if (op === 'in') {
    return Array.isArray(target) ? target.includes(raw) : String(target).includes(String(raw));
  }

  const bothNumeric = !isNaN(parseFloat(target)) && !isNaN(parseFloat(raw));
  const a = bothNumeric ? parseFloat(raw) : String(raw).toLowerCase();
  const b = bothNumeric ? parseFloat(target) : String(target).toLowerCase();

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
 * A target is a set of conditions that gate whether a rule/policy applies
 * at all. Empty target = always applicable.
 */
function evaluateTarget(target, logic, request) {
  if (!target || target.length === 0) return true;
  const results = target.map((c) => evaluateCondition(c, request));
  return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

// ---------------------------------------------------------------------------
// Rule / policy / policy-set evaluation
// ---------------------------------------------------------------------------

/**
 * @returns {'Permit'|'Deny'|'NotApplicable'|'Indeterminate'}
 */
function evaluateRule(rule, request) {
  try {
    const applicable = evaluateTarget(rule.target, rule.targetLogic || 'AND', request);
    return applicable ? rule.effect : 'NotApplicable';
  } catch (err) {
    return 'Indeterminate';
  }
}

function combineDecisions(decisions, algorithm) {
  if (algorithm === 'first-applicable') {
    const first = decisions.find((d) => d.decision !== 'NotApplicable');
    return first ? first.decision : 'NotApplicable';
  }
  if (algorithm === 'permit-overrides') {
    if (decisions.some((d) => d.decision === 'Permit')) return 'Permit';
    if (decisions.some((d) => d.decision === 'Deny')) return 'Deny';
    return 'NotApplicable';
  }
  // default: deny-overrides
  if (decisions.some((d) => d.decision === 'Deny')) return 'Deny';
  if (decisions.some((d) => d.decision === 'Permit')) return 'Permit';
  return 'NotApplicable';
}

/**
 * Evaluate one policy: check its target, then combine its rules'
 * decisions per its rule-combining algorithm.
 */
function evaluatePolicy(policy, request) {
  const policyApplicable = evaluateTarget(policy.target, policy.targetLogic || 'AND', request);
  if (!policyApplicable) {
    return { policyId: policy.id, name: policy.name, decision: 'NotApplicable', rules: [] };
  }

  const ruleResults = policy.rules.map((rule) => ({
    ruleId: rule.id,
    description: rule.description,
    effect: rule.effect,
    decision: evaluateRule(rule, request)
  }));

  const decision = combineDecisions(ruleResults, policy.ruleCombiningAlgorithm || 'deny-overrides');
  return { policyId: policy.id, name: policy.name, decision, rules: ruleResults };
}

/**
 * Top-level PDP entry point: evaluate every policy in the set and combine
 * across policies (deny-overrides by default — the safe default for access
 * control), then apply defaultEffect when nothing was applicable.
 *
 * @param {Object} request  { subject, resource, action, environment }
 * @param {Array}  policies
 * @param {Object} [options]
 * @param {'deny-overrides'|'permit-overrides'|'first-applicable'} [options.policyCombiningAlgorithm]
 * @param {'Deny'|'Permit'} [options.defaultEffect]  what to return when NotApplicable
 */
function decide(request, policies, options = {}, debug = false) {
  const algorithm = options.policyCombiningAlgorithm || 'deny-overrides';
  const defaultEffect = options.defaultEffect || 'Deny';

  const policyResults = policies.map((p) => evaluatePolicy(p, request));
  let decision = combineDecisions(policyResults, algorithm);
  if (decision === 'NotApplicable') decision = defaultEffect;

  const result = { decision, defaulted: decision === defaultEffect && policyResults.every(p => p.decision === 'NotApplicable'), policies: policyResults };

  if(debug)
    return { request, ...result };
  else return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateConditionShape(c, path) {
  const errors = [];
  if (!c.attr) errors.push(`${path}.attr is required`);
  if (!OPERATORS.has(c.op)) errors.push(`${path}.op is invalid`);
  if (c.value === undefined || c.value === '') errors.push(`${path}.value is required`);
  return errors;
}

function validatePolicyShape(body) {
  const errors = [];
  if (!body.name) errors.push('name is required');
  if (body.ruleCombiningAlgorithm && !RULE_ALGORITHMS.has(body.ruleCombiningAlgorithm)) {
    errors.push('ruleCombiningAlgorithm is invalid');
  }
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    errors.push('at least one rule is required');
  } else {
    body.rules.forEach((r, i) => {
      if (!EFFECTS.has(r.effect)) errors.push(`rules[${i}].effect must be Permit or Deny`);
      (r.target || []).forEach((c, ci) => errors.push(...validateConditionShape(c, `rules[${i}].target[${ci}]`)));
    });
  }
  (body.target || []).forEach((c, ci) => errors.push(...validateConditionShape(c, `target[${ci}]`)));
  return errors;
}