// SingleTon Management Module

const os = require("os");
const LIST = {};

module.exports = {

    initialize : async function() {
        console.log("\x1b[36m%s\x1b[0m", `\nSingleton Manager Initialized`);
        return true;
    },

    initiateSingleton: function(activityName, funcToStart, funcOnEnd, options = {}) {
        const t1 =  new SingletonManager(activityName, funcToStart, funcOnEnd, options);
        LIST[activityName] = t1;
        return t1;
    },

    listRunning: function() {
        return Object.keys(LIST);
    }
}

class SingletonManager {
  constructor(name, funcToStart, funcOnEnd, options = {}) {
    this.name = `singleton:${name}`;
    this.lockTTL = options.retry || 10;
    this.retryInterval = options.retry || (this.lockTTL-1) * 1000; // ms
    this.nodeId = `${os.hostname()}-${process.pid}`;
    this.isLeader = false;
    this.funcToStart = funcToStart;
    this.funcOnEnd = funcOnEnd;
    this.enabled = true;

    this.startHeartbeat();
  }

  async tryAcquire() {
    const result = await _CACHE.storeDataEx(this.name, this.nodeId, this.lockTTL, false);
    this.enabled = true;

    if (result === "OK") {
      this.isLeader = true;
      this.funcToStart({"timestamp": new moment().format("YYYY-MM-DD HH:mm:ss")});

      return true;
    }

    return false;
  }

  async startHeartbeat() {
    const CURRENT = this;

    await CURRENT.check();

    this.heartbeat = setInterval(async () => {
      if(!CURRENT.enabled) return;

        CURRENT.check();
    }, CURRENT.retryInterval);
  }

  async check() {
    const CURRENT = this;

    const current = await _CACHE.fetchDataSync(CURRENT.name);

    // console.log("SINGLETON_HEARTBEAT", CURRENT.name, CURRENT.isLeader, current, CURRENT.nodeId);

    if (current === CURRENT.nodeId) {
        await _CACHE.extendKey(CURRENT.name, CURRENT.lockTTL);
    } else if(!current) {
        CURRENT.tryAcquire();
    } else {
        // clearInterval(CURRENT.heartbeat);
        CURRENT.isLeader = false;
    }
  }

  async release() {
    const current = await _CACHE.fetchDataSync(this.name);
    if (current === this.nodeId) {
      await _CACHE.deleteKey(this.name);
    }
  }

  async stop() {
    CURRENT.enabled = false;
  }
}