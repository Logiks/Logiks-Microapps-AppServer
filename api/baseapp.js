//For Bootstraping the application


module.exports = {

    initializeApplication: function() {
        //Load all helpers
        fs.readdirSync('./api/helpers/').forEach(function(file) {
            if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
                var filePath = path.resolve('./api/helpers/' + file);
                var clsName = file.replace('.js','').toUpperCase();

                _ENV.HELPERS.push(clsName);
                global[clsName] = require(filePath)();

                if(typeof global[clsName].initialize === "function") {
                    try {
                        global[clsName].initialize();
                    } catch(e) {
                        console.error("Error Initializing Controller "+clsName, e.message);
                    }
                }
            }
        });

        //Load all controllers
        fs.readdirSync('./api/controllers/').forEach(function(file) {
            if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
                var filePath = path.resolve('./api/controllers/' + file);
                var clsName = file.replace('.js','').toUpperCase();

                _ENV.CONTROLLERS.push(clsName);
                global[clsName] = require(filePath)();

                if(typeof global[clsName].initialize === "function") {
                    try {
                        global[clsName].initialize();
                    } catch(e) {
                        console.error("Error Initializing Controller "+clsName, e.message);
                    }
                }
            }
        });

        console.log("\n\x1b[31m%s\x1b[0m","Bootstrapping Completed");
    },

    getAppInfo: async function(serverHost) {
        console.log("serverHost", serverHost);

        const tenantData = JSON.parse(fs.readFileSync("misc/tenants.json", "utf8"));

        var selectedTenant = tenantData.filter(a=>a.domain.indexOf(serverHost)>=0);

        if(selectedTenant.length<=0) {
            return false;
        }

        return selectedTenant[0];
    }
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