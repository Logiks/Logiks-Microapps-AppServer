//Replace of cacheMap function, this helps bringing everything smallest component to REDIS Only
//CACHEMAP.get("", "", "")
//CACHEMAP.set("", "", "")

module.exports = {

    initialize : function(callback) {
        console.log("\x1b[36m%s\x1b[0m","CacheMap Initialized");
    },

    get: async function(mapKey, dataKey, defaultValue = false) {
        const cacheKey = `CACHESTORE:${mapKey}`.toUpperCase();
        let cacheMap = await _CACHE.fetchDataSync(cacheKey, {});//"DBOPSMAP"
        
        try {
            if(!cacheMap) cacheMap = {};
            else if(typeof cacheMap == "string") cacheMap = JSON.parse(cacheMap);
        } catch(e) {
            cacheMap = {}
        }

        return cacheMap[dataKey] || defaultValue;
    },

    set: async function(mapKey, dataKey, dataValue) {
        const cacheKey = `CACHESTORE:${mapKey}`.toUpperCase();
        let cacheMap = await getCacheMapJSON(mapKey);

        cacheMap[dataKey] = dataValue;

        _CACHE.storeData(cacheKey, cacheMap);

        return dataValue;
    },
}

async function getCacheMapJSON(mapKey) {
    const cacheKey = `CACHESTORE:${mapKey}`.toUpperCase();
    let cacheMap = await _CACHE.fetchDataSync(cacheKey, {});//"DBOPSMAP"
    
    try {
        if(!cacheMap) cacheMap = {};
        else if(typeof cacheMap == "string") cacheMap = JSON.parse(cacheMap);
    } catch(e) {
        cacheMap = {}
    }

    return cacheMap;
}