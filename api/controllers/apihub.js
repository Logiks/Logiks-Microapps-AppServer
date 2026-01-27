/*
 * APIHub Controller
 * This controls all the API requests going out of the system
 * 
 * */

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","APIHub System Initialized");

        return true;
    },

    runAPI: async function(apiCode, params, ctx) {
        
    }
}

async function sendRequest(method, endPointURL, query, payload, headers, ctx) {
    

    return true;
}