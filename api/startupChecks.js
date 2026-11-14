"use strict";

//Startup secret checks.
//
//Outside NODE_ENV=development the server must not start with a missing, short or sample secret: a published
//secret lets anyone forge tokens or sessions. In development the same problems are only warnings.
//
//check(config, env, isDevelopment) -> { errors: [string], warnings: [string] }

const MIN_LENGTH = {
    "authjwt.secret": 32,
    "SALT_KEY": 16,
    "CLUSTER_TOKEN": 16,
    "SESSION_SECRET": 16,
    "ENC_SALT": 16
};

//Values that appear in the sample files, docs or tests. Compared case-insensitively.
const KNOWN_SAMPLE_VALUES = [
    "Zv7QFrJWhSz6j2kA",
    "new_salt_key_1234567890",
    "super-secret-cluster-token",
    "asdasd123213asd",
    "dev_super_secret_change_me",
    "unit-test-secret",
    "unit-test-jwt-secret"
].map(v => v.toLowerCase());

//"change-me-root", "REPLACE_ME", "your-secret-here", "password123" and similar placeholders
const PLACEHOLDER_RE = /change[-_ ]?me|replace[-_ ]?me|your[-_ ]?(secret|key|token|salt)|placeholder|example|sample|^(secret|password|test|admin|default)/i;

function problemWith(name, value) {
    if(typeof value !== "string" || value.trim().length === 0) return "is not set";

    const min = MIN_LENGTH[name];
    if(value.length < min) return `is too short (${value.length} characters, at least ${min} needed)`;

    if(KNOWN_SAMPLE_VALUES.includes(value.toLowerCase())) return "is a value from the sample files";
    if(PLACEHOLDER_RE.test(value)) return "looks like a placeholder";
    if(new Set(value).size < 8) return "has too little variety (repeated characters)";

    return null;
}

function check(config, env, isDevelopment) {
    config = config || {};
    env = env || {};

    const secrets = [
        { name: "authjwt.secret", where: "config.json", value: config.authjwt && config.authjwt.secret },
        { name: "SALT_KEY", where: "config.json", value: config.SALT_KEY },
        { name: "CLUSTER_TOKEN", where: ".env", value: env.CLUSTER_TOKEN },
        { name: "SESSION_SECRET", where: ".env", value: env.SESSION_SECRET },
        { name: "ENC_SALT", where: ".env", value: env.ENC_SALT }
    ];

    const errors = [];
    const warnings = [];

    for(const s of secrets) {
        const problem = problemWith(s.name, s.value);
        if(!problem) continue;

        const text = `${s.name} (${s.where}) ${problem}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
        (isDevelopment ? warnings : errors).push(text);
    }

    // Any website may call the API from a visitor's browser when every origin is allowed
    const corsOrigin = config.cors && config.cors.origin;
    if(!isDevelopment && (corsOrigin === "*" || (Array.isArray(corsOrigin) && corsOrigin.includes("*")))) {
        warnings.push('cors.origin allows every origin ("*"). List the real front-end origins instead.');
    }

    if(config.authjwt && config.authjwt.algorithm && !/^(HS|RS|ES|PS)(256|384|512)$/.test(config.authjwt.algorithm)) {
        errors.push(`authjwt.algorithm "${config.authjwt.algorithm}" is not a supported signing algorithm`);
    }

    return { errors, warnings };
}

module.exports = { check, problemWith };
