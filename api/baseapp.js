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
                        const isPublic = global[clsName].initialize();
                        if(isPublic===true) {
                            _ENV.CONTROLLERS_PUBLIC.push(clsName);
                        }
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
        
        switch(process.env.MIGRATION_MODE) {
            case "IMPORT":
                printObj("Running Migration - Importing", "yellow");
                _.each(_dbkeys(), async function(dbkey, k) {
                    await DBMIGRATOR.startMigration(dbkey);
                });
                break;
            case "EXPORT":
                printObj("Running Migration - Exporting", "yellow");
                _.each(_dbkeys(), async function(dbkey, k) {
                    await DBMIGRATOR.saveMigrationScript(dbkey);
                });
                break;
            default:
                printObj("Running Migration - Mode Not Supported", "grey");
        }

        AUTOJOBS.startJobs();

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
        if(!domainInfo || !domainInfo.results || domainInfo.results.length<=0) return false;
        
        return domainInfo.results[0];
    }
}
