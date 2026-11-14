//This is the common functions available and required at system level

const APP_EVENT_LISTENER = [];

module.exports = {

}

//Only dbkeys the running app actually configured & enabled - not every
//microapp defines a "logdb" alongside "appdb", so this must not assume both.
global._dbkeys = function() {
    return _DB.db_keys();
}

global.printObj = function(msg, clr, intent) {
  if(intent==null) intent = 2;
  if(clr==null) clr = "-";

  var newMsg = "";
  for (let k = 0; k < intent; k++) {
      newMsg = ">"+newMsg;
  }
  msg = newMsg+" "+msg;

  switch(clr.toLowerCase()) {
      case "grey":
          console.log("\x1b[30m%s\x1b[0m",`${msg}`);
          break;
      case "red":
          console.log("\x1b[31m%s\x1b[0m",`${msg}`);
          break;
      case "green":
          console.log("\x1b[32m%s\x1b[0m",`${msg}`);
          break;
      case "yellow":
          console.log("\x1b[33m%s\x1b[0m",`${msg}`);
          break;
      case "blue":
          console.log("\x1b[34m%s\x1b[0m",`${msg}`);
          break;
      case "pink":
          console.log("\x1b[35m%s\x1b[0m",`${msg}`);
          break;
      case "sky":
          console.log("\x1b[36m%s\x1b[0m",`${msg}`);
          break;
      default:
          console.log(msg);
  }
}

global._call = async function(serviceString, ...args) {
    // console.log("CALLING_SERVICE", serviceString);
    if(["Tables.source", "lgks.source", "do.source", "sys.source", "cache.source", "data.source"].indexOf(serviceString)>=0) return null;
    
    try {
        const response = await SERVER.getBroker().call(serviceString, ...args, {
                timeout: 5000,
                retries: 0
            });
        
        return response;
    } catch(err) {
        // console.error(err);
        if(args && args.length>0 && args[0].silent===true) {

        } else {
            log_error(err);
        }

        if(!(err.message.includes("Service") && err.message.includes("is not found."))) {
          log_error(err);
          return {
            "status": false,
            "err": err
          };
        }
        
        return false;
    }
}

//Allowlist matching used by the config whitelists (request_whitelist, token_access).
//An entry is an exact name ("files.upload"), a prefix ("reports.*", matches "reports.list" and "reports.x.y"),
//or "*" for everything. An empty or missing list allows nothing.
global._matchWhitelist = function(list, name) {
    if(!Array.isArray(list) || typeof name !== "string" || name.length === 0) return false;

    return list.some(function(entry) {
        if(typeof entry !== "string" || entry.length === 0) return false;
        if(entry === "*") return true;
        if(entry.endsWith(".*")) return name.startsWith(entry.slice(0, -1));
        return entry === name;
    });
}

//Platform admin = whoever may operate the whole cluster (restart nodes, read every tenant's data). This is deliberately
//not the per-tenant "admin" role. Configure with CONFIG.platform_admin = { privileges: [...], roles: [...] }.
global._isPlatformAdmin = function(user) {
    if(!user) return false;

    const cfg = CONFIG.platform_admin || {};
    const privileges = Array.isArray(cfg.privileges) ? cfg.privileges : ["root", "devroot"];
    const roles = Array.isArray(cfg.roles) ? cfg.roles : [];

    return privileges.includes(user.privilege) || (Array.isArray(user.roles) && user.roles.some(r => roles.includes(r)));
}

global.addAppEventListener = async function(eventKey, func) {
    APP_EVENT_LISTENER.push({eventKey, func});
}

global.runAppEventListeners = async function(activityKey, dataParams) {
    APP_EVENT_LISTENER.filter(a=>a.eventKey == activityKey || a.eventKey == activityKey.split(".")[0]).forEach(function(listnerObj, k) {
        listnerObj.func(dataParams, activityKey);
    })
}
