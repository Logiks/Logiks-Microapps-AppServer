/*
 * RBAC Controller for Application and Users
 * 
 * */

// const RBAC_CACHE = _CACHE.getCacheMap("RBACCACHE");
const RBAC_CACHE = {};

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","RBAC scopes, policies and access Initialized");
        return true;
    },

    getRoleId: function(ctx) {
        // ctx.meta.user
        // ctx.meta.appInfo
        // ctx.meta.appInfo.appid
        return `${ctx.meta.userguid}:${ctx.meta.useruserid}`;
    },

    //Check and Load RBAC Controls into Memory for processing
    reloadPolicies: async function(ctx) {
        const rbacRoleID = RBAC.getRoleId(ctx);
        const appid = ctx.meta.appInfo.appid;

        if(!RBAC_CACHE[appid] || !RBAC_CACHE[appid][rbacRoleID]) {
            delete RBAC_CACHE[appid][rbacRoleID];
        }
        await checkRBACControls(ctx);
    },

    processJSONComponent: async function(ctx, jsonObject) {
        var response = await filterByPolicy(jsonObject, async function(policyKey) {
            return await RBAC.checkPolicy(ctx, policyKey, false);
        });
        return response;
    },

    //policyStr = a.b.c format
    checkPolicy: async function(ctx, policyStr, defaultValue = false) {
        console.log("RBAC.checkPolicy", policyStr, defaultValue, ctx.meta.user, ctx.meta.appInfo, ctx.meta.appInfo.appid);
        if(!ctx || !ctx.meta.user || !ctx.meta.appInfo || !ctx.meta.appInfo.appid) return defaultValue;

        await checkRBACControls(ctx);

        const rbacRoleID = RBAC.getRoleId(ctx);
        const appid = ctx.meta.appInfo.appid;

        if(RBAC_CACHE[appid] && RBAC_CACHE[appid][rbacRoleID]) {
            return RBAC_CACHE[appid][rbacRoleID][policyStr] || defaultValue;
        }

        return defaultValue;
    },

    checkScope: async function(ctx, scopeStr, defaultValue = false) {
        return defaultValue;
    },

    registerPolicies: async function(appid, guid, policyArr, roles = false) {
        if(!roles) {
            //Load from lgks_roles
        }

        //batch insert into lgks_rolemodel
        //then load into the RBAC_CACHE
    },
}

async function checkRBACControls(ctx) {
    //appid, guid, userid
    const rbacRoleID = RBAC.getRoleId(ctx);
    const appid = ctx.meta.appInfo.appid;

    // RBAC_CACHE[appid][rbacRoleID]
    if(!RBAC_CACHE[appid] || !RBAC_CACHE[appid][rbacRoleID]) {
        //Load RBAC FROM lgks_roles
        //Load RBAC FROM lgks_rolemodel
    }

    return true;
}

async function filterByPolicy(obj, checkPolicy) {
  if (typeof obj !== "object" || obj === null) return obj;

  // If it's an array, process each element and remove invalid ones
  if (Array.isArray(obj)) {
    return obj
      .map(async item => await filterByPolicy(item, checkPolicy))
      .filter(item => item !== null);
  }

  // If this object itself contains "policy"
  if ("policy" in obj) {
    const isAllowed = await checkPolicy(obj.policy);
    if (!isAllowed) {
      return null; // Remove this entire parent object
    }
  }

  // Otherwise, recursively process children
  const result = {};
  for (const key in obj) {
    const filteredChild = await filterByPolicy(obj[key], checkPolicy);

    if (filteredChild !== null) {
      result[key] = filteredChild;
    }
  }

  return result;
}