const net = require("net");

/*
 * AUTHKEY Controller
 * 
 * */

module.exports = {

    initialize : function() {

    },

    getAPIKeyInfo : async function(apiKey, key_type) {
        // Keys are stored as "sha256:<hex>". A key stored in plain text (older rows, or a key just created by a plugin)
        // still matches, and is replaced by its hash the first time it is used.
        const hashedKey = "sha256:" + crypto.createHash("sha256").update(String(apiKey)).digest("hex");

        var whereCond = {
            "blocked": "false",
            "auth_key": [[String(apiKey), hashedKey], "IN"],
            // "key_type": key_type || "user" //api, s2s, user
        };
        whereCond[`FIND_IN_SET(${_DB.db_clean(key_type)}, key_type)`] = "RAW";

        var data = await _DB.db_selectQ("appdb", "lgks_apikeys", "*", whereCond, {});
        
        if(!data || !data.results || data.results.length<=0) return false;

        var apiKeyInfo = data.results[0];

        if(apiKeyInfo.auth_key === String(apiKey) && !(CONFIG.security && CONFIG.security.hash_api_keys === false)) {
            _DB.db_updateQ("appdb", "lgks_apikeys", { auth_key: hashedKey }, { id: apiKeyInfo.id })
                .catch(e => console.error("API key hash upgrade failed", e.message));
        }
        delete apiKeyInfo.auth_key;

        //MAP with a user if possible
        // if(apiKeyInfo.user_id && apiKeyInfo.user_id!="") {
        //     var userData = await _DB.db_selectQ("appdb", "lgks_users", "*", {"userId": apiKeyInfo.user_id, "blocked": "false"}, {});
        //     if(userData && userData.results && userData.results.length>0) {
        //         apiKeyInfo.userInfo = userData.results[0];
        //     }
        // }
        apiKeyInfo.userId = apiKeyInfo.for_user || apiKeyInfo.guid;
        // var userData = await _DB.db_selectQ("appdb", "lgks_users", "*", {"userId": userId, "blocked": "false"}, {});

        // A value that cannot be read grants nothing; it must never widen to "*"
        apiKeyInfo.roles = parseList(apiKeyInfo.roles);
        apiKeyInfo.scopes = parseList(apiKeyInfo.scopes);

        return apiKeyInfo;
    },

    //IP rules for an app (rows for the app or "*"). Entries are exact IPs or CIDR ranges ("10.0.0.0/8").
    //  - an IP matching a blacklist entry is always refused
    //  - onlyFailIfWhitelisted = true: everyone else is allowed (blacklist mode), unless CONFIG.security.ip_allowlist_enforced
    //    is true and the app has allow entries, in which case only those IPs pass
    //  - onlyFailIfWhitelisted = false: the IP must match an allow entry
    //Rules are cached for 30 seconds, so the database is not queried on every request.
    checkClientIP: async function(clientIP, appId, onlyFailIfWhitelisted = true) {
        const ip = String(clientIP || "").replace(/^::ffff:/, "");
        const rules = await loadIPRules(appId);

        const matches = rules.filter(rule => ipMatchesRule(ip, rule.ipaddress));

        if(matches.some(rule => rule.allow_type == "blacklist")) return false;

        const allowRules = rules.filter(rule => rule.allow_type != "blacklist");
        const allowed = matches.some(rule => rule.allow_type != "blacklist");

        if(onlyFailIfWhitelisted) {
            if(CONFIG.security && CONFIG.security.ip_allowlist_enforced === true && allowRules.length > 0 && !allowed) return false;
            return true;
        }

        return allowed;
    }
}

//JSON array, or a comma separated list; anything else is an empty list
function parseList(value) {
    if(Array.isArray(value)) return value;
    if(typeof value !== "string" || value.trim() === "") return [];

    try {
        const parsed = JSON.parse(value);
        if(Array.isArray(parsed)) return parsed;
        return [];
    } catch(e) {
        return value.split(",").map(v => v.trim()).filter(Boolean);
    }
}

const IP_RULE_CACHE = new Map();
const IP_RULE_TTL_MS = 30 * 1000;

async function loadIPRules(appId) {
    const cached = IP_RULE_CACHE.get(appId);
    if(cached && Date.now() - cached.at < IP_RULE_TTL_MS) return cached.rules;

    const data = await _DB.db_selectQ("appdb", "lgks_security_iplist", "*", {
        "blocked": "false",
        "site": [[appId, "*"], "IN"],
    }, {});
    const rules = (data && data.results) ? data.results : [];

    IP_RULE_CACHE.set(appId, { at: Date.now(), rules });
    return rules;
}

function ipMatchesRule(ip, rule) {
    const entry = String(rule || "").trim();
    if(!entry) return false;
    if(entry === "*" || entry === ip) return true;
    if(!entry.includes("/")) return false;

    try {
        const [base, bits] = entry.split("/");
        const family = net.isIPv6(base) ? "ipv6" : "ipv4";
        if(net.isIP(ip) === 0 || (family === "ipv6") !== net.isIPv6(ip)) return false;

        const list = new net.BlockList();
        list.addSubnet(base, parseInt(bits), family);
        return list.check(ip, family);
    } catch(e) {
        return false;
    }
}
