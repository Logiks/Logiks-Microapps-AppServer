//For Bootstraping the application

var applicationData = {};

module.exports = {

    initializeApplication: function() {
        //Load all helpers
        fs.readdirSync('./api/helpers/').forEach(function(file) {
            if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
                var filePath = path.resolve('./api/helpers/' + file);
                var clsName = file.replace('.js','').toUpperCase();

                _ENV.HELPERS.push(clsName);
                global[clsName] = require(filePath);
                
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
                global[clsName] = require(filePath);

                if(typeof global[clsName].initialize === "function") {
                    try {
                        global[clsName].initialize();
                    } catch(e) {
                        console.error("Error Initializing Controller "+clsName, e.message);
                    }
                }
            }
        });

        applicationData = JSON.parse(fs.readFileSync("misc/applications.json", "utf8"));

        console.log("\x1b[36m%s\x1b[0m",`Bootstrapping Completed with ${applicationData.length} Loaded Applications`);
    },

    //This does migrations and other tasks
    postInitalization: async function() {
        //Migration Testing and Running if required
        console.log("\x1b[36m%s\x1b[0m",`Checking if DB Migration is Required`);
        const DBKEYS = ["appdb", "logdb"];
        switch(process.env.MIGRATION_MODE) {
            case "IMPORT":
                printObj("Running Migration - Importing", "yellow");
                _.each(DBKEYS, async function(dbkey, k) {
                    await DBMIGRATOR.startMigration(dbkey);
                });
                break;
            case "EXPORT":
                printObj("Running Migration - Exporting", "yellow");
                _.each(DBKEYS, async function(dbkey, k) {
                    await DBMIGRATOR.saveMigrationScript(dbkey);
                });
                break;
            default:
                printObj("Running Migration - Mode Not Supported", "grey");
        }

        console.log("\x1b[36m%s\x1b[0m",`Post Initalization Completed`);
    },

    getAppInfo: async function(appID) {
        //var selectedApplication = applicationData.filter(a=>a.domain.indexOf(serverHost)>=0);
        var selectedApplication = applicationData.filter(a=>a.appid==appID);

        if(selectedApplication.length<=0) {
            return false;
        }
        
        return _.cloneDeep(selectedApplication[0]);
    },

    getAppForDomain: async function(serverHost) {
        var domainInfo = await _DB.db_selectQ("appdb", "lgks_domains", "*", {
                domain_host: serverHost,
                blocked: "false"
            },{});
        if(!domainInfo) return false;
        
        return domainInfo[0];
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

global._appcall = async function(serviceString, ...args) {
    console.log("CALLING_SERVICE", serviceString);

    return await SERVER.getBroker().call(serviceString, args, {
            timeout: 5000,
            retries: 0
        });
}