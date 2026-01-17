/*
 * caching functions
 * 
 * */

const ioredis = require("ioredis");
var redis = null;

//LocalStore stores and retrives various key data and uses redis as the backend to handle persistance
//This is purgable data holder and should not be used to store long term data as every data stored here may be purged

let CACHESTORE_MAP = null;
let CACHESTORE_MAP_KEY = null;
let CACHESTORE_SAVE_PERIOD = 0;

/*
 * Cache Storage Controls all the Caching Functionality. It helps speed up fetching various cached data directly
 * using indexes. This is important as REDIS Cache forms the core to our speed
 * 
 * */
module.exports = {

    initialize : async function() {
        redis = new ioredis(CONFIG.cache);

        while(redis.status!="ready") {
            printObj("Waiting for redis cache connection", "grey");
            await sleep(500);
        }

        console.log("\x1b[36m%s\x1b[0m","CACHE Initialized");

        const nodeID = process.env.SERVER_ID || os.hostname();
		CACHESTORE_MAP_KEY = `CACHESTORE:${nodeID}`;

		CACHESTORE_MAP = await _CACHE.fetchDataSync(CACHESTORE_MAP_KEY, {});

		if(!CACHESTORE_MAP) CACHESTORE_MAP = {};

		if(CACHESTORE_SAVE_PERIOD>0) {
			setInterval(function() {
				_CACHE.storeData(CACHESTORE_MAP_KEY, CACHESTORE_MAP);
			}, CACHESTORE_SAVE_PERIOD);//Auto Save
		}

        console.log("\x1b[36m%s\x1b[0m","CacheStore Initialized");
    },

    //All Redis functions
    getRedisInstance : function() {
        return redis;
    },

    cacheStatus : function() {
        return redis.status;
    },

    storeData : function(cacheKey, data) {
        if (redis.status != "ready") return data;
        
        if (typeof data == "object") data = JSON.stringify(data);
        redis.set(cacheKey, data);
        return data;
    },

    storeDataEx : function(cacheKey, data, expires) {
        if (redis.status != "ready") return data;

        if (typeof data == "object") data = JSON.stringify(data);
        
        redis.set(cacheKey, data, "EX", expires);//In Seconds
        return data;
    },

    fetchData : function(cacheKey, callback, defaultData = false) {

        if (redis.status != "ready") {
            callback(defaultData, "error");
            return;
        }
        cacheObj = this;
        result = false;

        redis.get(cacheKey).then(function (result) {
            if (result == null) {
                result = cacheObj.storeData(cacheKey, defaultData);
            }

            if (typeof result == "string") {
                try {
                    resultJSON = JSON.parse(result);
                    if (resultJSON != null) {
                        result = resultJSON;
                    }
                } catch (e) {

                }
            }

            callback(result);
        });
    },

    fetchDataSync : async function(cacheKey, defaultData = false) {
        if (redis.status != "ready") {
            return defaultData;
        }
        cacheObj = this;
        result = false;

        var result = await redis.get(cacheKey);

        if (result == null) {
            result = cacheObj.storeData(cacheKey, defaultData);
        }

        if (typeof result == "string") {
            try {
                resultJSON = JSON.parse(result);
                if (resultJSON != null) {
                    result = resultJSON;
                }
            } catch (e) {

            }
        }

        return result
    },

    deleteKey : async function(cacheKey) {
        // clearCache(cacheKey);
        return await redis.del(cacheKey);
    },

    listCacheKeys : function(pattern, callback) {
        if(pattern==null) pattern = "*";

        keysArr = [];
        redis.keys(pattern).then(function (keys) {
            keys.forEach(function (key) {
              keysArr.push(key);
            });

            callback(keysArr);
          });
    },

    clearCache : function(pattern) {
        if(pattern==null) pattern = "*";
        //'sample_pattern:*'
        return redis.keys(pattern).then(function (keys) {
            // Use pipeline instead of sending one command each time to improve the performance.
            var pipeline = redis.pipeline();
            keys.forEach(function (key) {
              pipeline.del(key);
            });
            return pipeline.exec();
          });
    },

    //All Cache Store related functions
    getCacheMap: async function(mapkey) {
		if(CACHESTORE_MAP[mapkey]) return CACHESTORE_MAP[mapkey];
		else return {};
	},

    listCacheKeys: function() {
        return Object.keys(CACHESTORE_MAP);
    },

	saveCacheMap: async function(mapkey, mapData) {
		CACHESTORE_MAP[mapkey] = mapData;
		
		if(CACHESTORE_SAVE_PERIOD==0) {
			await _CACHE.storeData(CACHESTORE_MAP_KEY, CACHESTORE_MAP);
		}
	},

	deleteCacheMap: async function(mapkey) {
		
		if(CACHESTORE_MAP[mapkey]) delete CACHESTORE_MAP[mapkey];
		
		await _CACHE.storeData(CACHESTORE_MAP_KEY, CACHESTORE_MAP);
	},

	clearCacheMap : async function() {
		CACHESTORE_MAP = {};
		await _CACHE.storeData(CACHESTORE_MAP_KEY, CACHESTORE_MAP);
	}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}