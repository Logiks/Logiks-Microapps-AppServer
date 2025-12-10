/*
 * Main Server, this is the starting point of full system
 * 
 * @author : Bismay <bismay@smartinfologiks.com>
 * */
const packageConfig = require('./package.json');

require("dotenv").config();

// -------------------------
// ENV & CONFIG
// -------------------------
const REQUIRED_ENV = ["SERVER_ID", "TRANSPORTER", "NODE_ENV"];
REQUIRED_ENV.forEach((key) => {
	if (!process.env[key]) {
		console.error(`❌ Missing required env variable: ${key}`);
		process.exit(1);
	}
});

global._ENV = {SERVICES:[], HELPERS: [], CONTROLLERS: []};
global.CONFIG = {};

global._ = require("lodash");
global.fs = require("fs");
global.path = require("path");
global.axios = require("axios");
global.moment = require("moment");
global.crypto = require('crypto');

global.ROOT_PATH = __dirname;
global.START_TIME = moment().format();

console.log("\x1b[34m%s\x1b[0m","\nAppServer Initialization Started\n");

//Loading Moleculer Errors for all
// const { Errors } = require("moleculer");
// global.Errors = Errors;

// const { promisify } = require("util");
// global.promisify = promisify;

//Load Core Modules
const LOGGER = require('./api/logger');
global.LOGGER = LOGGER;

const CACHE = require('./api/cache');
global._CACHE = CACHE;

LOGGER.preinitialze();

// -------------------------
// Application Initialization
// -------------------------

global.BASEAPP = require('./api/baseapp');
const SERVER = require('./api/server');
global.SERVER = SERVER;

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

    global.CONFIG = _.extend({}, tempConfig, packageConfig, {
        "SERVER_ID": process.env.SERVER_ID,
        "ROOT_PATH": __dirname,
        "VERSION": packageConfig.version,
        "BUILD": packageConfig.version.replaceAll(/\./g, "")
    });

    await _CACHE.initialize();

    LOGGER.initializeLoggers();

    BASEAPP.initializeApplication();

    SERVER.start();

    setTimeout(async function() {
        await BASEAPP.postInitalization();

        console.log("\n\x1b[32m%s\x1b[0m\n", `AppServer Started @ `+moment().format()+` and can be accessed on ${process.env.HOST}:${process.env.PORT}/`);
    }, 2000);
}

//starting the main service
main();
