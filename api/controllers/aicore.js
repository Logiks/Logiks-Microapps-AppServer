//AICore provides the AI Layer used across the platform by core and plugins
//This layer itself forms the 4th Layer for T4 archicture of Logiks

const LogiksAI = require("./aicore/logiksai");

var aiEngine = false;

module.exports = {

    initialize: function() {
        if(CONFIG.aicore) {
            aiEngine = false;
            switch(CONFIG.aicore.engine) {
                case "logiksai":

                    aiEngine = new LogiksAI(CONFIG.aicore.params);

                    console.log("\x1b[36m%s\x1b[0m","LogiksAI Engine Initialized");
                    break;
                default:
                    console.log("\x1b[31m%s\x1b[0m","LogiksAI Engine Disabled, Engine not supported");
            }
        } else {
            console.log("\x1b[31m%s\x1b[0m","LogiksAI Engine Disabled");
        }

        return true;
    },

    sendMessage: async function(msgObject, sessId, moduleId, ctx) {
        console.log(">>>>>>>>>>>>>>>", aiEngine);
    }
}

