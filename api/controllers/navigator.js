/*
 * Navigator/Menu Controller
 * 
 * */

const NAVIGATOR_CACHE = {};//_CACHE.getCacheMap("NAVIGATORCACHE");
//_CACHE.saveCacheMap("NAVIGATORCACHE", NAVIGATOR_CACHE);
//if(CONFIG.disable_cache.navigator) ctx.params.recache = true;

module.exports = {

    initialize : async function() {
    },

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

    getNavigation: async function(appID, navID, userInfo) {
        if(!NAVIGATOR_CACHE[appID]) NAVIGATOR_CACHE[appID] = {};
        if(!NAVIGATOR_CACHE[appID][navID]) {
            const appMenuDir = `misc/apps/${appID}/menus/${navID}/`;
            if(fs.existsSync(appMenuDir)) {
                const menuTempObj = await loadAllJsonFromFolder(appMenuDir);

                NAVIGATOR_CACHE[appID][navID] = menuTempObj;

                _CACHE.saveCacheMap("NAVIGATOR_CACHE", NAVIGATOR_CACHE);
            } else {
                NAVIGATOR_CACHE[appID][navID] = [];
            }
        }

        const menuObj = NAVIGATOR_CACHE[appID][navID];
        
        return menuObj.filter(a=> {
            //Check if is enabled
            if(a.blocked && a.blocked===false) {
                return false;
            }

            //Check GUID
            if(!(a.guid && (a.guid=="*" || a.guid=="global" || a.guid==userInfo.guid))) {
                return false;
            }

            if(a.privilege) {
                if(typeof a.privilege == "string") a.privilege = a.privilege.split(",");
                // console.log(a.title, a.privilege);
                if(!(a.privilege.indexOf("*")>=0 || a.privilege.indexOf(userInfo.privilege)>=0 || a.privilege.indexOf(userInfo.userId)>=0)) {
                    return false;
                }
            }
            return true;
        });
    }
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