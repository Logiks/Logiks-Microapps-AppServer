//For Encryption and decryption tasks

const crypto = require('crypto');
const sha1 = require('sha1');
const bcrypt = require("bcrypt");

let ALGORITHM = 'aes-256-gcm';
let IV_LENGTH = 16; // recommended 96-bit nonce

let MASTER_SALT = "";
let HASH_MODE = "sha1";

module.exports = {

    initialize : async function() {
        const encKey = `EK${process.env.SERVER_ID}`;

        if(process.env.ENC_SALT && process.env.ENC_SALT.length>0) {
            MASTER_SALT = process.env.ENC_SALT;
        } else {
            var encryptionKey = await _CACHE.fetchDataSync(encKey);
            if(!encryptionKey) {
                encryptionKey = crypto.randomBytes(8).toString('hex');
                await _CACHE.storeData(encKey, encryptionKey);

                console.log("MASTER_ENCRYPTION_KEY, this is one time printed, store it for recovery purpose", encryptionKey);
            }
            MASTER_SALT = encryptionKey;
        }

        console.log("\x1b[36m%s\x1b[0m","Encryption Engien Initialized");
    },

    encrypt : function(text, encryptionKey) {
        if (!text) return null;
        if(!encryptionKey) encryptionKey = CONFIG.SALT_KEY;

        const KEY = crypto.createHash('sha256').update(encryptionKey).digest(); // 32 bytes

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    },

    decrypt : function(encryptedText, encryptionKey) {
        if (!encryptedText) return null;
        if(!encryptionKey) encryptionKey = CONFIG.SALT_KEY;

        const KEY = crypto.createHash('sha256').update(encryptionKey).digest(); // 32 bytes

        const data = Buffer.from(encryptedText, 'base64');

        const iv = data.subarray(0, IV_LENGTH);
        const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
        const encrypted = data.subarray(IV_LENGTH + 16);

        const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
        decipher.setAuthTag(tag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    },

    generateHash : async function(content, pwdSalt = false) {
        if(!pwdSalt) pwdSalt = MASTER_SALT;

        if(typeof content == "object") content = JSON.stringify(content);

        if(HASH_MODE=="sha1") return sha1(pwdSalt+""+content);
        return await bcrypt.hash(pwdSalt+""+content, 10);
    },

    compareHash: async function(password, passwordHash, pwdSalt = false) {
        if(!pwdSalt) pwdSalt = MASTER_SALT;

        if(HASH_MODE=="sha1") {
            const hashNew = await ENCRYPTER.generateHash(password);
            console.log("NEW HASH", hashNew);
            return hashNew===passwordHash;
        } else
            return await bcrypt.compare(password, passwordHash);
    }
}