//This is the common functions available and required at system level

const APP_EVENT_LISTENER = [];
const DBKEYS = ["appdb", "logdb"];

module.exports = {

}

global._dbkeys = function() {
    return DBKEYS;
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
        
        return null;
    }
}

global.addAppEventListener = async function(eventKey, func) {
    APP_EVENT_LISTENER.push({eventKey, func});
}

global.runAppEventListeners = async function(activityKey, dataParams) {
    APP_EVENT_LISTENER.filter(a=>a.eventKey == activityKey || a.eventKey == activityKey.split(".")[0]).forEach(function(listnerObj, k) {
        listnerObj.func(dataParams, activityKey);
    })
}
