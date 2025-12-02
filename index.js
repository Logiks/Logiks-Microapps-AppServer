/*
 * Main Server, this is the starting point of full system
 * 
 * @author : Bismay <bismay@smartinfologiks.com>
 * */
const packageConfig = require('./package.json');

require("dotenv").config();

global._ENV = {SERVICES:[], HELPERS: [], CONTROLLERS: []};
global._CONFIG = {};

global._ = require("lodash");
global.fs = require("fs");
global.path = require("path");
global.axios = require("axios");
global.moment = require("moment");

global.START_TIME = moment().format();

console.log("\x1b[34m%s\x1b[0m","\nAppServer Initialization Started\n");

//Load Core Modules
const BASEAPP = require('./api/baseapp');
const SERVER = require('./api/server');

async function main() {
    var tempConfig = {};
    switch(process.env.CONFIG_TYPE) {
        case "LOCAL":
            tempConfig = require(process.env.CONFIG_FILE);
            break;
        case "REMOTE":
            try {
                var tempData = await axios.get(process.env.CONFIG_FILE);
                tempConfig = tempData.data;
            } catch(e) {
                console.error("\n\nConfig File Not Found, Shuting Down Server @ "+moment().format(), e.message);
                process.exit(0);
            }
            break;
        default:
            console.info("\n\nConfig Type Not Supported, Skipping the loading of Config");
    }

    global._CONFIG = _.extend({}, tempConfig, packageConfig, {
        "SERVER_ID": process.env.SERVER_ID,
        "ROOT_PATH": __dirname,
    });

    BASEAPP.initializeApplication();
    SERVER.start();

    // console.log("");

    console.log("\n\x1b[34m%s\x1b[0m", "AppServer Initialization Completed");
    console.log("\n\x1b[32m%s\x1b[0m", `Server Started @ `+moment().format()+` and can be accessed on ${process.env.HOST}:${process.env.PORT}/`);
}

//starting the main service
main();

//For Debugging Purpose only
// console.log("\n", _CONFIG);