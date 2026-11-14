//For Encryption and decryption tasks

const crypto = require('crypto');
const sha1 = require('sha1');
const bcrypt = require("bcrypt");
const { pipeline } = require("stream/promises");
const { PassThrough, Transform } = require("stream");
const fs = require("fs");

let MAGIC = Buffer.from("ENC1");
let ALGORITHM = 'aes-256-gcm';
let IV_LENGTH = 16; // recommended 96-bit nonce
let KEY_LENGTH = 32;
const TAG_LENGTH = 16;

let MASTER_SALT = "";
let HASH_MODE = "sha1";

function passwordPrehash(password) {
    return crypto.createHmac("sha256", MASTER_SALT).update(String(password)).digest("base64");
}

function secretsKey() {
    return crypto.createHash("sha256").update("secrets:" + MASTER_SALT).digest();
}

module.exports = {

    initialize : async function() {
        // ENC_SALT is mandatory outside development (checked at startup). It is part of every stored password
        // hash, so it must stay the same for the life of the database: never generate or print one here.
        if(process.env.ENC_SALT && process.env.ENC_SALT.length>1) {
            MASTER_SALT = process.env.ENC_SALT;
        } else if(isDevelopment) {
            MASTER_SALT = "development-only-enc-salt";
            console.warn("ENC_SALT is not set: using a fixed development salt. Set ENC_SALT to keep password hashes stable.");
        } else {
            throw new Error("ENC_SALT must be set outside development");
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

    //Passwords: bcrypt (cost 12, a salt of its own per password) over an HMAC of the password keyed with ENC_SALT.
    //The HMAC step adds a server-side pepper and keeps long inputs inside bcrypt's 72 byte limit.
    hashPassword: async function(password) {
        return await bcrypt.hash(passwordPrehash(password), 12);
    },

    //-> { valid, needsUpgrade }. Accepts the new bcrypt format and the old sha1(ENC_SALT + password) format;
    //needsUpgrade is true for the old one, so the caller can store a new hash after a successful login.
    verifyPassword: async function(password, storedHash) {
        if(typeof storedHash !== "string" || storedHash.length === 0) return { valid: false, needsUpgrade: false };

        if(storedHash.startsWith("$2")) {
            return { valid: await bcrypt.compare(passwordPrehash(password), storedHash), needsUpgrade: false };
        }

        const legacy = Buffer.from(sha1(MASTER_SALT + "" + password));
        const stored = Buffer.from(storedHash);
        const valid = legacy.length === stored.length && crypto.timingSafeEqual(legacy, stored);
        return { valid, needsUpgrade: valid };
    },

    //Secrets kept in database columns (MFA seeds, key material). Passes through values that were stored before this existed.
    protect: function(text) {
        if(text === null || text === undefined || text === "") return text;

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", secretsKey(), iv);
        const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
        return "enc:v1:" + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
    },

    unprotect: function(value) {
        if(typeof value !== "string" || !value.startsWith("enc:v1:")) return value;

        const data = Buffer.from(value.slice(7), "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", secretsKey(), data.subarray(0, 12));
        decipher.setAuthTag(data.subarray(12, 28));
        return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
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
        const key = crypto.scryptSync(
                encryptionKey,
                CONFIG.SALT_KEY,
                32
            );

        const cipher = crypto.createCipheriv(
            ALGORITHM,
            key,
            iv
        );

        const input = fs.createReadStream(inputFile, {
            //highWaterMark: 1024 * 1024 // 1MB chunks
            highWaterMark: 8 * 1024 * 1024 //4–8 MB gives better throughput than the default 64 KB.
        });

        const output = fs.createWriteStream(outputFile);

        // Write IV first
        output.write(Buffer.concat([MAGIC, iv]));

        await pipeline(
            input,
            cipher,
            output
        );

        // Append Auth Tag
        const authTag = cipher.getAuthTag();
        fs.appendFileSync(outputFile, authTag);

        console.log("Encrypted File", outputFile);
        return outputFile;
    },

    decryptFile: async function(inputFile, encryptionKey, outputFile = false) {
        if (!outputFile) outputFile = inputFile.replace(".enc", "");

        const stat = fs.statSync(inputFile);
        const fd = fs.openSync(inputFile, "r");

        // Read and verify MAGIC
        const magic = Buffer.alloc(MAGIC.length);
        fs.readSync(fd, magic, 0, MAGIC.length, 0);

        if (!magic.equals(MAGIC)) {
            fs.closeSync(fd);
            throw new Error("Invalid encrypted file");
        }

        // FIX 1: IV starts after MAGIC
        const iv = Buffer.alloc(IV_LENGTH);
        fs.readSync(fd, iv, 0, IV_LENGTH, MAGIC.length);

        const authTag = Buffer.alloc(TAG_LENGTH);
        fs.readSync(
            fd,
            authTag,
            0,
            TAG_LENGTH,
            stat.size - TAG_LENGTH
        );

        fs.closeSync(fd);

        const key = crypto.scryptSync(
            encryptionKey,
            CONFIG.SALT_KEY,
            32
        );

        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            key,
            iv
        );

        decipher.setAuthTag(authTag);

        const input = fs.createReadStream(inputFile, {
            // FIX 2: Skip MAGIC + IV
            start: MAGIC.length + IV_LENGTH,
            end: stat.size - TAG_LENGTH - 1,
            highWaterMark: 1024 * 1024
        });

        const output = fs.createWriteStream(outputFile);

        await pipeline(input, decipher, output);

        console.log("Decrypted File", outputFile);

        return outputFile;
    },

    //encryptStream(fs.createReadStream("big.iso"), key).pipe(fs.createWriteStream("big.iso.enc"));
    // encryptStream(
    //     fs.createReadStream("big.iso", {
    //         highWaterMark: 8 * 1024 * 1024
    //     }),
    //     key
    // ).pipe(
    //     fs.createWriteStream("big.iso.enc", {
    //         highWaterMark: 8 * 1024 * 1024
    //     })
    // );
    encryptStream: async function(readable, encryptionKey) {
        const iv = crypto.randomBytes(IV_LENGTH);

        const key = crypto.scryptSync(
                encryptionKey,
                CONFIG.SALT_KEY,
                32
            );

        const cipher = crypto.createCipheriv(
            ALGORITHM,
            key,
            iv
        );

        const output = new PassThrough();

        // Write header immediately
        output.write(Buffer.concat([MAGIC, iv]));

        cipher.pipe(output, { end: false });

        cipher.on("end", () => {
            output.end(cipher.getAuthTag());
        });

        cipher.on("error", err => output.destroy(err));
        readable.on("error", err => output.destroy(err));

        readable.pipe(cipher);

        return output;
    },

    //decryptStream(fs.createReadStream("big.iso.enc"), key).pipe(fs.createWriteStream("big.iso"));
    // const rs = fs.createReadStream("big.iso.enc", {
    //     highWaterMark: 8 * 1024 * 1024 // 8 MB
    // });

    // const ws = fs.createWriteStream("big.iso", {
    //     highWaterMark: 8 * 1024 * 1024
    // });

    // decryptStream(rs, key).pipe(ws);
    decryptStream: function(readable, encryptionKey) {
        let header = Buffer.alloc(0);
        let decipher = null;
        let tail = Buffer.alloc(0);

        const transform = new Transform({
            transform(chunk, encoding, callback) {
                try {
                    if (!decipher) {
                        header = Buffer.concat([header, chunk]);

                        if (header.length < MAGIC.length + IV_LENGTH) {
                            return callback();
                        }

                        const magic = header.subarray(0, MAGIC.length);

                        if (!magic.equals(MAGIC)) {
                            return callback(
                                new Error("Invalid encrypted stream.")
                            );
                        }

                        const iv = header.subarray(
                            MAGIC.length,
                            MAGIC.length + IV_LENGTH
                        );
                        const key = crypto.scryptSync(
                            encryptionKey,
                            CONFIG.SALT_KEY,
                            32
                        );

                        decipher = crypto.createDecipheriv(
                            ALGORITHM,
                            key,
                            iv
                        );

                        chunk = header.subarray(
                            MAGIC.length + IV_LENGTH
                        );

                        // Header no longer needed
                        header = null;
                    }

                    /*
                     * Always retain the last TAG_LENGTH bytes.
                     * Those bytes are the GCM auth tag.
                     */
                    tail = Buffer.concat([tail, chunk]);

                    if (tail.length <= TAG_LENGTH) {
                        return callback();
                    }

                    const ciphertextLength =
                        tail.length - TAG_LENGTH;

                    const ciphertext = tail.subarray(
                        0,
                        ciphertextLength
                    );

                    tail = tail.subarray(ciphertextLength);

                    const out = decipher.update(ciphertext);

                    if (out.length) {
                        this.push(out);
                    }

                    callback();

                } catch (err) {
                    callback(err);
                }
            },

            flush(callback) {
                try {
                    if (!decipher) {
                        throw new Error("Empty stream.");
                    }

                    if (tail.length !== TAG_LENGTH) {
                        throw new Error(
                            "Invalid encrypted stream."
                        );
                    }

                    decipher.setAuthTag(tail);

                    const out = decipher.final();

                    if (out.length) {
                        this.push(out);
                    }

                    callback();

                } catch (err) {
                    callback(err);
                }
            }
        });

        readable.on("error", err => {
            transform.destroy(err);
        });

        return readable.pipe(transform);
    }
}