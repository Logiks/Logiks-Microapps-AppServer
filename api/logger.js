/*
 * Winston Logger Replacement for Bunyan
 * LEVELS: trace, debug, info, warn, error, fatal
 */

const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");

module.exports = {
  LOGGERS: {},

  preinitialze: function () {
    const that = this;

    const transports = [];

    transports.push(
        new winston.transports.Console({
          level: process.env.CORE_LOGGER_LEVEL || "info",
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              return `${timestamp} [${level}] ${message} ${JSON.stringify(meta)}`;
            })
          ),
        })
      );

    that.LOGGERS["core"] = winston.createLogger({
        levels: {
          fatal: 0,
          error: 1,
          warn: 2,
          info: 3,
          debug: 4,
          trace: 5,
        },
        level: "trace",
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        transports,
      });

      global._LOGGER = this.LOGGERS["core"];

      console.log("\x1b[36m%s\x1b[0m", "LOGGERS Initialized (Core)");
  },

  logKeys: function () {
    return Object.keys(this.LOGGERS);
  },

  get: function (logKey) {
    if (logKey == null || this.LOGGERS[logKey]==undefined) logKey = "core";
    return this.LOGGERS[logKey];
  },

  registerLogger: function (logKey, loggerInstance) {
    this.LOGGERS[logKey] = loggerInstance;
  },

  initializeLoggers: function () {
    const that = this;

    _.each(CONFIG.logger, function (logParams, logKey) {
      const transports = [];

      logParams.forEach((cfg) => {
        // Console stream
        if (cfg.stream === "stdout") {
          transports.push(
            new winston.transports.Console({
              level: cfg.level,
              format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                  return `${timestamp} [${level}] ${message} ${JSON.stringify(meta)}`;
                })
              ),
            })
          );
        }

        // Normal file log (info.log)
        if (cfg.path && !cfg.period) {
          transports.push(
            new winston.transports.File({
              filename: cfg.path,
              level: cfg.level,
            })
          );
        }

        // Rotating error log
        if (cfg.path && cfg.period) {
          transports.push(
            new DailyRotateFile({
              filename: cfg.path.replace(".log", "-%DATE%.log"),
              level: cfg.level,
              datePattern: "YYYY-MM-DD",
              zippedArchive: true,
              maxSize: "10m",
              maxFiles: "10d",
            })
          );
        }
      });

      that.LOGGERS[logKey] = winston.createLogger({
        levels: {
          fatal: 0,
          error: 1,
          warn: 2,
          info: 3,
          debug: 4,
          trace: 5,
        },
        level: "trace",
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        transports,
      });
    });

    console.log("\x1b[36m%s\x1b[0m", "LOGGERS Initialized (All)");
  },

  log: function (logObj, logKey, logLevel) {
    if (logKey == null) logKey = "default";
    if (logLevel == null) logLevel = "info";

    const logControl =
      this.LOGGERS[logKey] || this.LOGGERS["default"];

    if (typeof logObj === "string") {
      logObj = { msg: logObj };
    }

    logObj = _.extend(
      {
        timestamp: global.timeStamp ? global.timeStamp() : new Date().toISOString(),
      },
      logObj
    );

    if (logObj.msg == null && logObj.message != null) {
      logObj.msg = logObj.message;
    }

    const msgString = logObj.msg || "";

    if (logControl) {
      logControl.log({
        level: logLevel,
        message: msgString,
        ...logObj,
      });
    } else {
      console.log("LOGGER KEY MISSING", logKey);
    }
  },
};
