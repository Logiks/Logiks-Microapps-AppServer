/*
 * Navigator/Menu Controller
 * 
 * */

const NAVIGATOR_CACHE = {};//_CACHE.getCacheMap("NAVIGATORCACHE");
//_CACHE.saveCacheMap("NAVIGATORCACHE", NAVIGATOR_CACHE);
//if(CONFIG.disable_cache.navigator) ctx.params.recache = true;

module.exports = {

    initialize : async function() {
        return true; //Public Controller
    },

    getNavigation: async function(appID, navID, deviceType, userInfo, filter, ctx) {
        if(!NAVIGATOR_CACHE[appID]) NAVIGATOR_CACHE[appID] = {};

        if(!userInfo.privilege) userInfo.privilege = "";
        if(!userInfo.roles) userInfo.roles = [];
        if(!userInfo.scopes) userInfo.scopes = {};
        
        if(!filter) filter = {};

        filter = {
            ...filter,
            "onmenu": "true",
            "guid": userInfo.guid,
            "privilege": [["*", userInfo.privilege, userInfo.userId, ...userInfo.scopes, ...userInfo.roles.map(a=>`role:${a}`)], "IN"],
            //"privilege": [["*", ...userInfo.privilege], "IN"],
        };
        if(deviceType && deviceType.length>0) {
            filter['device'] = [["*", deviceType], "IN"];
        }
        
        filter[`FIND_IN_SET('${navID}', menuid)`] = "RAW";

        const dbLinks = await _DB.db_selectQ("appdb", "do_links", "*", _.extend({}, filter, {
            "blocked": "false",
            "guid": [["global", userInfo.tenantId], "IN"],
            "site": [["*", appID], "IN"],
        }), {}, " ORDER BY weight ASC");

        var finalLinks = [];
        _.each(dbLinks?.results, async function(link, k) {
            // Process link URL
            // if(link.linktype == "internal") {
            //     link.url = _APPCONFIG.getInternalLink(link.link);
            // } else if(link.linktype == "external") {
            //     link.url = link.link;
            // } else if(link.linktype == "module") {
            //     link.url = _APPCONFIG.getModuleLink(link.link, appID);
            // } else {
            //     link.url = "#";
            // }
            // link.url = _APPCONFIG.processLink(link.link, link.linktype, appID);
            if(link.to_check && link.to_check.length>0) {
                const toCheck = link.to_check.split(",");
                for(const checkItem of toCheck) {
                    const checkArr = checkItem.split(":");

                    switch(checkArr[0]) {
                        case "policy":
                            const response = await RBAC.checkPolicy(ctx, checkArr[1]);
                            if(!response) {
                                dbLinks.results[k].blocked = "true";
                            }
                            break;
                        case "module":
                            break;
                        default:
                            break;
                    }
                }
            }

            finalLinks.push(link);
        });
        
        return finalLinks.filter(a=>a.blocked!=="true");
    },

    //Importing and Manual Adding
    addNavigation: async function(appID, navID, menuItems) {
        if(!Array.isArray(menuItems)) return false;

        if(Array.isArray(appID)) {
            _.each(appID, function(appid, k) {
                if(!NAVIGATOR_CACHE[appid]) NAVIGATOR_CACHE[appid] = {};
                if(!NAVIGATOR_CACHE[appid][navID]) NAVIGATOR_CACHE[appid][navID] = [];

                NAVIGATOR_CACHE[appid][navID] = _.extend(NAVIGATOR_CACHE[appid][navID], menuItems);
            });
        } else if(appID == "*") {
            const appList = APPLICATION.getAppList();
            _.each(appList, function(appid, k) {
                if(!NAVIGATOR_CACHE[appid]) NAVIGATOR_CACHE[appid] = {};
                if(!NAVIGATOR_CACHE[appid][navID]) NAVIGATOR_CACHE[appid][navID] = [];

                NAVIGATOR_CACHE[appid][navID] = _.extend(NAVIGATOR_CACHE[appid][navID], menuItems);
            });
        } else {
            if(!NAVIGATOR_CACHE[appID]) NAVIGATOR_CACHE[appID] = {};
            if(!NAVIGATOR_CACHE[appID][navID]) NAVIGATOR_CACHE[appID][navID] = [];

            NAVIGATOR_CACHE[appID][navID] = _.extend(NAVIGATOR_CACHE[appID][navID], menuItems);
        }

        _CACHE.saveCacheMap("NAVIGATOR_CACHE", NAVIGATOR_CACHE);

        return true;
    },

    importNavigtaion: async function(appID, menuArray) {
        // if(!NAVIGATOR_CACHE[appID][navID]) {
        //     const menuTempObj = loadMenuFolder(appID, navID);
        //     if(!menuTempObj) menuTempObj = [];

        //     NAVIGATOR_CACHE[appID][navID] = menuTempObj;

        //     //_CACHE.saveCacheMap("NAVIGATOR_CACHE", NAVIGATOR_CACHE);
        // }

        // const menuObj = NAVIGATOR_CACHE[appID][navID];
        
        // return menuObj.filter(a=> {
        //     //Check if is enabled
        //     if(a.blocked && a.blocked===false) {
        //         return false;
        //     }

        //     //Check GUID
        //     if(!(a.guid && (a.guid=="*" || a.guid=="global" || a.guid==userInfo.guid))) {
        //         return false;
        //     }

        //     if(a.privilege) {
        //         if(typeof a.privilege == "string") a.privilege = a.privilege.split(",");
        //         // console.log(a.title, a.privilege);
        //         if(!(a.privilege.indexOf("*")>=0 || a.privilege.indexOf(userInfo.privilege)>=0 || a.privilege.indexOf(userInfo.userId)>=0)) {
        //             return false;
        //         }
        //     }
        //     return true;
        // });
    },
}

async function loadMenuFolder(appID, navID) {
    const appMenuDir = `misc/apps/${appID}/menus/${navID}/`;
    if(fs.existsSync(appMenuDir)) {
        const menuTempObj = await loadAllJsonFromFolder(appMenuDir);
        return menuTempObj;
    } else return [];
}

async function loadAllJsonFromFolder(folderPath) {
  const files = await fs.readdirSync(folderPath);

  const jsonFiles = files.filter(f => f.endsWith(".json"));

  const jobs = jsonFiles.map(async file => {
    const fullPath = path.join(folderPath, file);
    try {
      const data = await fs.readFileSync(fullPath, "utf8");
      return JSON.parse(data);
    } catch (e) {
      console.error(`❌ ${file} ignored: ${e.message}`);
      return null;
    }
  });

  const results = await Promise.all(jobs);

  return results.filter(Boolean); // remove failed reads
}