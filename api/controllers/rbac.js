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
            return await RBAC.checkPolicy(ctx, policyKey);//false
        });
        return response;
    },

    buildPolicyTable: async function(ctx) {
        const policyCatalog = await ctx.call("system.policyCatalog");
        //const policyItems = [...new Set(Object.values(policyCatalog).flatMap(innerObj => Object.keys(innerObj)))];
        const policyList = Object.values(policyCatalog).reduce((acc, innerObj) => {
                        Object.keys(innerObj).forEach(key => {
                            acc[key] = innerObj[key];
                        });
                        return acc;
                    }, {});
        const policyItems = Object.keys(policyList);

        // console.log("policyCatalog", policyCatalog);

        const roleList = await _DB.db_selectQ("appdb", "lgks_rolemodel", "*", {
            "guid": ctx.meta.user.guid,
            "site": ctx.meta.appInfo.appid,
            "blocked": "false",
            "policystr": [policyItems, "IN"]
        })
        if(!roleList.results) roleList.results = [];

        if(roleList.results.length==policyItems.length) {
            return {
                status: "success",
                created: 0,
                total: roleList.results.length
            };
        }
        const existingPolicies = roleList.results.map(obj => obj.policystr);
        const newPolicies = policyItems.filter(a=>!existingPolicies.includes(a.toLowerCase()));
        
        var bulkInsert = [];
        for (let index = 0; index < newPolicies.length; index++) {
            const policyStr = newPolicies[index];
            const policyArr = policyStr.split(".");
            const policyRemarks = policyStr.replaceAll('.', ' ').replace(/\b\w/g, l => l.toUpperCase());

            bulkInsert.push(_.extend({
                site: ctx.meta.appInfo.appid, 
                category: "Generated",
                policystr: policyStr.toLowerCase(),
                module: policyArr[0],
                activity: policyArr[1],
                action: policyArr[2],
                remarks: policyRemarks,
                allowed_roles: ((policyList[policyStr]=="true" || policyList[policyStr]===true)?"*":""),
                role_type: "auto",
                rolehash: await ENCRYPTER.generateHash(`${ctx.meta.appInfo.appid}${ctx.meta.user.guid}${policyStr}`),
            }, MISC.generateDefaultDBRecord(ctx, false)));
        }
        
        const dbResponse = await _DB.db_insert_batchQ("appdb", "lgks_rolemodel", bulkInsert);
        // console.log("newPolicies", newPolicies, bulkInsert, dbResponse);
        return {
            status: "success",
            created: newPolicies.length,
            total: (newPolicies.length+existingPolicies.length)
        };
    },

    //policyStr = a.b.c format
    checkPolicy: async function(ctx, policyStr, defaultValue = false) {
        console.log("RBAC.checkPolicy", policyStr, defaultValue, ctx.meta.user, ctx.meta.appInfo, ctx.meta.appInfo.appid, ctx.meta.user.roles);
        if(!ctx || !ctx.meta.user || !ctx.meta.appInfo || !ctx.meta.appInfo.appid) return defaultValue;

        // await checkRBACControls(ctx);
        await RBAC.reloadPolicies(ctx);

        const rbacRoleID = RBAC.getRoleId(ctx);
        const appid = ctx.meta.appInfo.appid;
        const userRoles = ctx.meta.user.roles;

        if(RBAC_CACHE[appid] && RBAC_CACHE[appid][rbacRoleID]) {
            if(!RBAC_CACHE[appid][rbacRoleID][policyStr]) RBAC_CACHE[appid][rbacRoleID][policyStr] = [];
            else if(typeof RBAC_CACHE[appid][rbacRoleID][policyStr] == "string") RBAC_CACHE[appid][rbacRoleID][policyStr] = RBAC_CACHE[appid][rbacRoleID][policyStr].split(",");
            
            const allowedRoles = RBAC_CACHE[appid][rbacRoleID][policyStr];
            //policyStr.toLowerCase().includes("blacklist")

            const hasAllowedRoles = [...new Set(userRoles)].filter(item => allowedRoles.includes(item.toLowerCase()));
            if(hasAllowedRoles.length>0) return true;

            if(allowedRoles.includes(`PRIVILEGE:${ctx.meta.user.privilege}`)) true;

            if(allowedRoles.includes(`USER:${ctx.meta.user.userId}`)) true;
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
    const roles = ctx.meta.user.roles;

    if(roles.length<=0) return false;

    if(!RBAC_CACHE[appid]) RBAC_CACHE[appid] = {};

    if(!RBAC_CACHE[appid] || !RBAC_CACHE[appid][rbacRoleID]) {
        //Load RBAC FROM lgks_roles
        //Load RBAC FROM lgks_rolemodel

        var whereLogic = {
            "guid": ctx.meta.user.guid,
            "site": ctx.meta.appInfo.appid,
            "blocked": "false",
            // "policystr": [policyItems, "IN"]
        };

        //whereLogic[roles.map(a=>`FIND_IN_SET('${a}',allowed_roles)`).join(" OR ")] = "RAW";
        whereLogic[roles.map(a=>`FIND_IN_SET('${a}',allowed_roles)`).join(" OR ")] = "RAW";

        const roleList = await _DB.db_selectQ("appdb", "lgks_rolemodel", "*", whereLogic);
        if(!roleList?.results) roleList.results = [];

        var tempRoleList = {};
        roleList.results.forEach(role=> {
            if(role.policystr && role.policystr.length>0) {
                tempRoleList[role.policystr.toLowerCase()] = role.allowed_roles.toLowerCase().split(",");
            }
        });
        RBAC_CACHE[appid][rbacRoleID] = tempRoleList;

        return true;
    }

    return false;
}

async function filterByPolicy(obj, checkPolicy) {
  if (typeof obj !== "object" || obj === null) return obj;

  // If it's an array, process each element and remove invalid ones
  if (Array.isArray(obj)) {
    for (let index = 0; index < obj.length; index++) {
        const item = obj[index];
        var response = await filterByPolicy(item, checkPolicy);
        if(!response) delete obj[index];
    }
    return Object.values(obj);
    // return obj
    //   .map(async (item) => {
    //     var result = await filterByPolicy(item, checkPolicy);
    //     return result;
    //   })
    //   .filter(item => item !== null);
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