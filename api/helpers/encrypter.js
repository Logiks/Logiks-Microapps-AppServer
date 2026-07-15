//For Encryption and decryption tasks

const crypto = require('crypto');
const sha1 = require('sha1');
const bcrypt = require("bcrypt");
const { pipeline } = require("stream/promises");
const fs = require("fs");

let MAGIC = Buffer.from("ENC1");
let ALGORITHM = 'aes-256-gcm';
let IV_LENGTH = 16; // recommended 96-bit nonce
let KEY_LENGTH = 32;

let MASTER_SALT = "";
let HASH_MODE = "sha1";

module.exports = {

    initialize : async function() {
        const encKey = `EK${process.env.SERVER_ID}`;

        if(process.env.ENC_SALT && process.env.ENC_SALT.length>1) {
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

        console.log("\x1b[36m%s\x1b[0m","Encryption Engine Initialized");
    },

    encrypt : async function(text, encryptionKey) {
        if (!text) return null;
        if(!encryptionKey) encryptionKey = CONFIG.SALT_KEY;

        encryptionKey = await KEYMANAGER.getKey(encryptionKey);

        const KEY = crypto.createHash('sha256').update(encryptionKey).digest(); // 32 bytes

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return Buffer.concat([iv, tag, encrypted]).toString('base64');
    },

    decrypt : async function(encryptedText, encryptionKey) {
        if (!encryptedText) return null;
        if(!encryptionKey) encryptionKey = CONFIG.SALT_KEY;

        encryptionKey = await KEYMANAGER.getKey(encryptionKey);

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
            // console.log("NEW HASH", hashNew);
            return hashNew===passwordHash;
        } else
            return await bcrypt.compare(password, passwordHash);
    },

    encryptFile: async function(inputFile, encryptionKey) {
        const outputFile = inputFile+".enc";
        const iv = crypto.randomBytes(IV_LENGTH);

        const cipher = crypto.createCipheriv(
            ALGORITHM,
            encryptionKey,
            iv
        );

        const input = fs1.createReadStream(inputFile, {
            //highWaterMark: 1024 * 1024 // 1MB chunks
            highWaterMark: 8 * 1024 * 1024 //4–8 MB gives better throughput than the default 64 KB.
        });

        const output = fs1.createWriteStream(outputFile);

        // Write IV first
        output.write(iv);

        await pipeline(
            input,
            cipher,
            output
        );

        // Append Auth Tag
        const authTag = cipher.getAuthTag();
        fs1.appendFileSync(outputFile, authTag);

        console.log("Encrypted File", outputFile);
        return outputFile;
    },

    decryptFile: async function(inputFile, encryptionKey) {
        const outputFile = inputFile.replace(".enc", "");

        const stat = fs1.statSync(inputFile);

        const fd = fs1.openSync(inputFile, "r");

        const iv = Buffer.alloc(IV_LENGTH);
        fs1.readSync(fd, iv, 0, IV_LENGTH, 0);

        const authTag = Buffer.alloc(AUTH_TAG_LENGTH);
        fs1.readSync(
            fd,
            authTag,
            0,
            AUTH_TAG_LENGTH,
            stat.size - AUTH_TAG_LENGTH
        );

        fs1.closeSync(fd);

        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            encryptionKey,
            iv
        );

        decipher.setAuthTag(authTag);

        const input = fs1.createReadStream(inputFile, {
            start: IV_LENGTH,
            end: stat.size - AUTH_TAG_LENGTH - 1,
            highWaterMark: 1024 * 1024
        });

        const output = fs1.createWriteStream(outputFile);

        await pipeline(
            input,
            decipher,
            output
        );

        console.log("Decrypted File", outputFile);

        return outputFile;
    },

    encryptStream: async function(readable, writable, encryptionKey) {
        const iv = crypto.randomBytes(IV_LENGTH);

        // Create output file
        const writable = fs1.createWriteStream(outputFile, {
            highWaterMark: 8 * 1024 * 1024
        });

        // Reserve header space
        writable.write(Buffer.alloc(HEADER_LENGTH));

        const cipher = crypto.createCipheriv(
            ALGORITHM,
            encryptionKey,
            iv
        );

        // Encrypt stream
        await pipeline(
            readable,
            cipher,
            writable
        );

        // Header
        const tag = cipher.getAuthTag();

        const header = Buffer.concat([
            MAGIC,
            iv,
            tag
        ]);

        // Patch header
        const file = await fs.promises.open(outputFile, "r+");

        try {

            await file.write(
                header,
                0,
                HEADER_LENGTH,
                0
            );

        } finally {

            await file.close();

        }

        return outputFile;
    },

    decryptStream: async function(inputFile, outputFile, encryptionKey) {
        const file = await fs.promises.open(inputFile, "r");

        try {

            const header = Buffer.alloc(HEADER_LENGTH);

            await file.read(
                header,
                0,
                HEADER_LENGTH,
                0
            );

            if (!header.subarray(0, 4).equals(MAGIC)) {
                throw new Error("Invalid encrypted file.");
            }

            const iv = header.subarray(
                4,
                4 + IV_LENGTH
            );

            const tag = header.subarray(
                4 + IV_LENGTH,
                HEADER_LENGTH
            );

            const decipher = crypto.createDecipheriv(
                ALGORITHM,
                encryptionKey,
                iv
            );

            decipher.setAuthTag(tag);

            await pipeline(
                fs.createReadStream(inputFile, {
                    start: HEADER_LENGTH,
                    highWaterMark: 8 * 1024 * 1024
                }),
                decipher,
                writable
            );

        } finally {

            await file.close();

        }
    }
}