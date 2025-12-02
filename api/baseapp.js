//For Bootstraping the application


module.exports = {

    initializeApplication: function() {
        //Load all helpers
        fs.readdirSync('./api/helpers/').forEach(function(file) {
            if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
                var filePath = path.resolve('./api/helpers/' + file);
                var clsName = file.replace('.js','').toUpperCase();

                _ENV.HELPERS.push(clsName);
                global[clsName] = require(filePath);
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

        

        console.log("\n\x1b[31m%s\x1b[0m","Bootstrapping Completed");
    }
}