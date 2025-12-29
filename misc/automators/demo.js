/*
 * Demo Automator
 * 
 * */

module.exports = {

    initialize: function() {
        printObj("Demo Job Initialization", "grey");
    },

    runJob: async function(params) {
        console.log("Running Demo Job", params);
        return true;
    }
}