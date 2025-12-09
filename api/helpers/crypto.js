//For Encryption and decryption tasks

const crypto = require('crypto');

let ALGORITHM = 'aes-256-gcm';
let IV_LENGTH = 16; // recommended 96-bit nonce


module.exports = {

    initialize : function() {
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
    }
}

