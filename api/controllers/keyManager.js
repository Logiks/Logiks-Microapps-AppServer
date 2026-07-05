/*
 * Key Manager Controller
 * It is responsible for storing and retrieving keys from a database or any other storage mechanism. 
 * It provides an interface for other parts of the application to interact with the key management system.
 * 
 * Table to be used : 
 * */

const sha1 = require('sha1');
const EXISTING_KEYS = {};
const KEY_ALGOS = ["sha1", "sha256", "sha512", "md5"];

module.exports = {

    initialize: function() {
        console.log("\x1b[36m%s\x1b[0m","KeyManager Engine Initialized");
    },

    getKey: async function(keyId, guid = "-") {
        // return sha1(keyId + CONFIG.SALT_KEY);
        if(EXISTING_KEYS[`${guid}${keyId}`]) return EXISTING_KEYS[`${guid}${keyId}`];
        
        const keyData = await KEYMANAGER.getStoredKey(keyId, guid, false);
        return keyData.key;
    },

    generateKey: async function(keyId, guid, algo = "sha1") {
        // return sha1(name + key + (algo || "") + CONFIG.SALT_KEY);
        if(KEY_ALGOS.indexOf(algo) < 0) algo = "sha1";
        const dated = new Date().toISOString();
        
        const newKey = UNIQUEID.generate(10);
        await _DB.db_insertQ1("appdb", "lgks_kms", {
                "guid": guid,

                "key_title": keyId.split(":")[0].replace(/_/g, " ").toUpperCase(),
                "key_module": keyId.split(":")[0],
                "key_id": keyId,
                "key_value": newKey,
                "key_algo": algo,
                "key_history": "",
                "key_vers": "1",
                "blocked": "false", 
                "created_on": dated, 
                "created_by": "system", 
                "edited_on": dated, 
                "edited_by": "system", 
            });

        EXISTING_KEYS[`${guid}${keyId}`] = getKeyValue(keyId, newKey, algo, "1");
        return EXISTING_KEYS[`${guid}${keyId}`];
    },

    getStoredKey: async function(keyId, guid, generateNotFound = true) {
        const whereLogic = {
            blocked: "false",
            guid: guid,
            key_id: keyId
        };

        var data = await _DB.db_selectQ("appdb", "lgks_kms", "key_id, key_vers, key_value, key_algo, key_history", whereLogic,{});
        if(!data || !data?.results || data.results.length<=0) {
            //generate new Key
            if(generateNotFound) {
                EXISTING_KEYS[`${guid}${keyId}`] = await this.generateKey(keyId, guid);
                
                return {
                    key: EXISTING_KEYS[`${guid}${keyId}`],
                    key_algo: "sha1",
                    history: (data.results[0].key_history || "").split(",").filter(k => k.trim() != "")
                };
            } else {
                EXISTING_KEYS[`${guid}${keyId}`] = getKeyValue(keyId, CONFIG.SALT_KEY, "sha1", "1");

                return {
                    key: EXISTING_KEYS[`${guid}${keyId}`],
                    key_algo: "sha1",
                    history: (data.results[0].key_history || "").split(",").filter(k => k.trim() != "")
                };
            }
        } else {
            EXISTING_KEYS[`${guid}${keyId}`] = getKeyValue(keyId, data.results[0].key_value, data.results[0].key_algo, `${data.results[0].key_vers}`);

            return {
                key: EXISTING_KEYS[`${guid}${keyId}`],
                key_algo: data.results[0].key_algo,
                history: (data.results[0].key_history || "").split(",").filter(k => k.trim() != "")
            };
        }
    }
}

function getKeyValue(key_id, key_value, key_algo, key_vers) {
    return `${sha1(key_id + key_value + CONFIG.SALT_KEY)}:${key_vers}:${KEY_ALGOS.indexOf(key_algo)}`;
}