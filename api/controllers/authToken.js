/*
 * Auth/Login Related Controller
 * */

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const sha1 = require('sha1');

const JWT_SECRET = CONFIG.authjwt.secret;
const JWT_ALGORITHM = CONFIG.authjwt.algorithm || "HS256";//RS256, HS256
const ACCESS_TOKEN_TTL = Number(CONFIG.authjwt.access_token_ttl || 3600);              // seconds
const REFRESH_TOKEN_TTL = Number(CONFIG.authjwt.refresh_token_ttl || 7 * 24 * 3600);   // seconds

module.exports = {

    initialize: function() {
        
    },

    generateToken: async function(appId, userInfo = {}, ctx, encrypt = true, expiry = ACCESS_TOKEN_TTL) {
        const sessionId = sha1(`${userInfo?.id || userInfo.userId}:${Date.now()}`);
        const accessJti = `acc:${sessionId}`;
        const refreshJti = `ref:${sessionId}`;

        const ip = ctx?.meta?.ip || ctx?.meta?.remoteIP || ctx?.request?.ip || ctx?.request?.headers['x-forwarded-for'] || ctx?.request?.connection?.remoteAddress || '';
        const deviceType = ctx?.meta?.deviceType || ctx?.request?.headers['user-agent'] || '';
        
        const payloadBase = {
            sessionId: sessionId,
            source: ctx?.meta?.appInfo?.appid || ctx?.request?.headers['x-app-id'] || 'na',
            userId: userInfo.userId,
            username: userInfo.name,
            tenantId: userInfo.tenantId,
            privilege: userInfo.privilege,
            ip,
            deviceType
        };

        const accessToken = jwt.sign(
                {
                    type: "access",
                    uuid: sha1(userInfo.userId),
                    // ...payloadBase
                    payload: (encrypt) ? await ENCRYPTER.encrypt(JSON.stringify(payloadBase), JWT_SECRET) : payloadBase
                },
                JWT_SECRET,
                {
                    algorithm: JWT_ALGORITHM,
                    expiresIn: expiry,
                    jwtid: accessJti
                }
            );
        
        return accessToken;
    },

    verifyToken: async function(appId, token, ctx) {
        let payload = false;

        try {
            payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
        } catch (err) {
            console.error("Token verification failed:", err);
            return null;
        }

        if(!payload || !payload.payload) {
            return null;
        }

        try {
            const decoded = JSON.parse(await ENCRYPTER.decrypt(payload.payload, JWT_SECRET));
            return decoded;
        } catch (err) {
            if(typeof payload.payload == "object") return payload.payload;
            else return null;
        }
    }
}