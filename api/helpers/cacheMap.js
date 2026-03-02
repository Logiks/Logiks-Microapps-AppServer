//Replace of cacheMap function, this helps bringing everything smallest component to REDIS Only
//CACHEMAP.get("", "", "")
//CACHEMAP.set("", "", "")

module.exports = {

    initialize : function(callback) {
        console.log("\x1b[36m%s\x1b[0m","CacheMap Initialized");
    },

    get: async function(mapKey, dataKey, defaultValue = false, ctx) {
        const cacheKey = `CACHESTORE:${ctx?.meta?.user?.userId}:${mapKey}:${dataKey}`.toUpperCase();
        let cacheMap = await _CACHE.fetchDataSync(cacheKey, {});//"DBOPSMAP"
        
        try {
            if(!cacheMap) cacheMap = {};
            else if(typeof cacheMap == "string") cacheMap = JSON.parse(cacheMap);
        } catch(e) {
            cacheMap = {}
        }

        return cacheMap || {};
    },

    set: async function(mapKey, dataKey, dataValue, ctx) {
        const cacheKey = `CACHESTORE:${ctx?.meta?.user?.userId}:${mapKey}:${dataKey}`.toUpperCase();
        // let cacheMap = await getCacheMapJSON(cacheKey);

        // cacheMap[dataKey] = dataValue;

        await _CACHE.storeData(cacheKey, dataValue);

        return dataValue;
    },
}

// async function getCacheMapJSON(cacheKey) {
//     let cacheMap = await _CACHE.fetchDataSync(cacheKey, {});//"DBOPSMAP"
    
//     try {
//         if(!cacheMap) cacheMap = {};
//         else if(typeof cacheMap == "string") cacheMap = JSON.parse(cacheMap);
//     } catch(e) {
//         cacheMap = {}
//     }

//     return cacheMap;
// }