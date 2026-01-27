/*
 * Webhooks Controller
 * This controls all external API endpoint provider for automation, cron jobs and data extractors
 * Works with Header Keys and IP Whitelisting
 * No Authentication System is required to use webhooks
 * 
 * */

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","Webhook System Initialized");
    },

    receiveRequest: async function(endpoint, ctx) {
        console.log("\x1b[35m%s\x1b[0m","WEBHOOK RECIEVED", endpoint, ctx.query, ctx.params, ctx.headers, ctx.meta);
        return true;
    }
}
