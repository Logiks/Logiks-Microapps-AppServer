/*
 * Federated Logins Related Controller
 * */

const { parseStringPromise, processors } = require("xml2js");
const { SignedXml } = require("xml-crypto");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const xpath = require("xpath");

const SAML_CLOCK_SKEW_MS = 2 * 60 * 1000;
const SAML_REPLAY_WINDOW_SEC = 15 * 60;
const XMLDSIG_NS = "http://www.w3.org/2000/09/xmldsig#";

module.exports = {

    initialize: function() {
        return true;
    },

    getEngines: function() {
        return [
            {
                "id": "azuread2",
                "name": "Azure AD (SAML 2.0)",
                "description": "Use Azure AD as authentication provider for your application. You can use any SAML 2.0 compliant identity provider with this engine.",
                "params": {
                    "application_name": "required",
                    "application_id": "required",
                    "object_id": "required",
                    "tenant_id": "required",
                    "idp_cert": "required",//signing certificate of the identity provider (PEM, or the base64 body)
                    "login_url": "required|url",
                    "logout_url": "required|url",
                    "entra_identifier": "url",
                    "scope": "string"//default: openid profile email offline_access User.Read
                }
            },
            {
                "id": "logiksauth",
                "name": "LogiksAuth (Logiks Auth 1.0)",
                "description": "Use LogiksAuth as authentication provider for your application.",
                "params": {
                    "url": "required|url",
                    "appid": "required", 
                    "scope": "string"//default: *
                }
            }
        ]
    },

    //federatedLoginID = ssoId
    resolveTenantByFederation: async function(appId, federatedLoginID, ssoSource) {
        const federatedLogin = await this.getFederatedLogin(appId, federatedLoginID);
        if(!federatedLogin) return false;

        return federatedLogin["guid"];
    },

    listFederatedLogins: async function(appId) {
        var whereCond = {
            "blocked": "false",
            "appid": appId
        };
        var data = await _DB.db_selectQ("appdb", "lgks_federatedlogins", "title, engine, refid", whereCond, {});

        if(!data || !data.results || data.results.length<=0) data = { results: [] };

        return data.results;
    },

    getFederatedLogin: async function(appId, federatedLoginID) {
        var whereCond = {
            "blocked": "false",
            "appid": appId
        };
        const safeLoginID = _DB.db_clean(String(federatedLoginID));
        whereCond[`(refid=${safeLoginID} OR id=${safeLoginID})`] = "RAW";

        var data = await _DB.db_selectQ("appdb", "lgks_federatedlogins", "*", whereCond, {});

        if(!data || !data.results || data.results.length<=0) data = { results: [] };

        const row = data.results[0];
        if(!row) return false;

        // params is stored as JSON text
        if(typeof row.params === "string") {
            try { row.params = JSON.parse(row.params); } catch(e) { row.params = {}; }
        }
        if(!row.params || typeof row.params !== "object") row.params = {};

        return row;
    },

    getFederatedLoginEndpoint: async function(appid, federatedLoginID, ctx) {
        const federatedLogin = await this.getFederatedLogin(appid, federatedLoginID);
        if(!federatedLogin) return false;

        // A random value tied to this login attempt, returned by the identity provider and checked (once) on return
        const state = require("crypto").randomBytes(24).toString("hex");
        await _CACHE.getRedisInstance().set(`fedstate:${state}`, JSON.stringify({ fid: federatedLogin.id, appid: appid }), "EX", 600);

        if(federatedLogin) {
            switch(federatedLogin.engine) {
                case "azuread2":
                    const tenantId = federatedLogin.params.tenant_id;
                    const clientId = federatedLogin.params.application_id;
                    const scope = federatedLogin.params.scope || "openid profile email offline_access User.Read";
                    
                    const returnURL = `https://${ctx.meta.serverHost}/callback/auth/${federatedLogin.refid}`;
                    const authURL = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(returnURL)}&response_mode=query&scope=${encodeURIComponent(scope)}&state=${state}`;
                    const logoutURL = `https://login.microsoftonline.com/${tenantId}/saml2`;
                    
                    return {
                        "authlink": authURL,
					    "logout": logoutURL
                    };
                case "logiksauth":
                    const baseURL = federatedLogin.params.url;
                    const appId = federatedLogin.params.appid;
                    const loginScope = federatedLogin.params.scope || "*";

                    const returnURL1 = `https://${ctx.meta.serverHost}/callback/auth/${federatedLogin.refid}`;// `${ctx.meta.serverHost}auth/logiksauth-login`;
                    const authURL1 = `${baseURL}authenticate?appid=${encodeURIComponent(appId)}&scope=${encodeURIComponent(loginScope)}&returnURL=${encodeURIComponent(returnURL1)}&state=${state}`;
                    const logoutURL1 = `${baseURL}logout?appid=${appId}&returnURL=${encodeURIComponent(returnURL1)}`;

                    return {
                        "authlink": authURL1,
					    "logout": logoutURL1
                    };
            }
        }
        
        console.log("getFederatedLoginEndpoint", federatedLogin);

        return {
            "status": "error",
            "message": "Unsupported federated login source"
        }
    },

    //true only when the response carries a valid signature from the configured identity provider
    verifyFederatedLoginResponse: async function(appid, federatedLoginID, ctx) {
        const userData = await this.processFederatedLoginResponse(appid, federatedLoginID, ctx);
        return !!userData;
    },

    //Returns the user data read from the SIGNED assertion, or false. Nothing in the response is trusted until
    //the signature, issuer, audience, validity window and one-time use have all been checked.
    processFederatedLoginResponse: async function(appid, federatedLoginID, ctx) {
        const federatedLogin = await this.getFederatedLogin(appid, federatedLoginID);
        if(!federatedLogin) return false;

        switch(federatedLogin.engine) {
            case "azuread2":
                try {
                    if(!ctx.params.SAMLResponse || typeof ctx.params.SAMLResponse !== "string") throw new Error("no SAMLResponse");

                    // The login must have been started by this server: state (or RelayState) is single use.
                    // A login that is started at the identity provider (IdP-initiated) can opt out with require_state = false.
                    if((federatedLogin.params || {}).require_state !== false) {
                        const state = ctx.params.state || ctx.params.RelayState;
                        if(!state || typeof state !== "string" || !/^[a-f0-9]{48}$/.test(state)) throw new Error("missing or malformed state");

                        const rawState = await _CACHE.getRedisInstance().getdel(`fedstate:${state}`);
                        const saved = rawState ? JSON.parse(rawState) : null;
                        if(!saved || saved.fid !== federatedLogin.id || saved.appid !== appid) throw new Error("unknown or already used state");
                    }

                    const SAMLContent = Buffer.from(ctx.params.SAMLResponse, "base64").toString("utf-8");

                    const assertion = await readSignedAssertion(SAMLContent, federatedLogin.params || {});
                    const userData = await mapAzureAssertion(assertion);

                    return userData;
                } catch(e) {
                    // The reason stays in the server log; the caller only learns that login failed
                    console.error("SAML login rejected:", e.message);
                    return false;
                }
            case "logiksauth":
                // Not implemented, so never accepted
                return false;
        }

        return false;
    }
}

// ---------------------------------------------------------------------------------------------
// SAML helpers
// ---------------------------------------------------------------------------------------------

function asArray(v) {
    if(v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
}

function textOf(v) {
    if(v === undefined || v === null) return undefined;
    if(Array.isArray(v)) return textOf(v[0]);
    if(typeof v === "object") return v._ !== undefined ? String(v._) : undefined;
    return String(v);
}

function toPem(cert) {
    const raw = String(cert || "").trim();
    if(!raw) return null;
    if(raw.includes("BEGIN CERTIFICATE")) return raw;

    const body = raw.replace(/\s+/g, "");
    return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`;
}

//Checks the XML signature against the configured certificate (a key inside the message is never used) and returns
//the Assertion exactly as it was signed. Content outside the signed part is ignored, which defeats signature wrapping.
function extractSignedAssertionXml(xml, certPem) {
    if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DTD / entity declarations are not allowed");

    const doc = new DOMParser({
        errorHandler: {
            warning: () => {},
            error: (m) => { throw new Error("invalid XML: " + m); },
            fatalError: (m) => { throw new Error("invalid XML: " + m); }
        }
    }).parseFromString(xml, "text/xml");

    const signatures = xpath.select(`//*[local-name(.)='Signature' and namespace-uri(.)='${XMLDSIG_NS}']`, doc);
    if(!signatures.length) throw new Error("response is not signed");

    for(const signatureNode of signatures) {
        const sig = new SignedXml({
            publicCert: certPem,
            getCertFromKeyInfo: () => null
        });

        try {
            sig.loadSignature(signatureNode);
            if(!sig.checkSignature(xml)) continue;
        } catch(e) {
            continue;
        }

        for(const signed of sig.getSignedReferences()) {
            const fragment = new DOMParser().parseFromString(signed, "text/xml");
            const root = fragment.documentElement;
            if(!root) continue;

            if(root.localName === "Assertion") return signed;

            if(root.localName === "Response") {
                const inner = xpath.select("//*[local-name(.)='Assertion']", fragment);
                if(inner.length === 1) return new XMLSerializer().serializeToString(inner[0]);
            }
        }
    }

    throw new Error("no valid signature over an assertion");
}

async function readSignedAssertion(xml, params) {
    const certPem = toPem(params.idp_cert);
    if(!certPem) throw new Error("idp_cert is not configured for this login");

    const assertionXml = extractSignedAssertionXml(xml, certPem);

    const parsed = await parseStringPromise(assertionXml, {
        explicitArray: false,
        tagNameProcessors: [processors.stripPrefix]
    });
    const assertion = parsed && parsed.Assertion;
    if(!assertion) throw new Error("assertion missing");

    // Issuer
    const issuer = textOf(assertion.Issuer);
    const expectedIssuer = params.idp_issuer || `https://sts.windows.net/${params.tenant_id}/`;
    if(!issuer || issuer.replace(/\/+$/, "") !== String(expectedIssuer).replace(/\/+$/, "")) throw new Error("unexpected issuer");

    // Audience
    const expectedAudiences = [params.entra_identifier, params.application_id, params.application_id ? `api://${params.application_id}` : null].filter(Boolean);
    if(expectedAudiences.length === 0) throw new Error("no audience configured for this login");
    const audiences = asArray(assertion.Conditions && assertion.Conditions.AudienceRestriction).flatMap(r => asArray(r.Audience)).map(textOf);
    if(!audiences.some(a => expectedAudiences.includes(a))) throw new Error("assertion is for another audience");

    // Validity window
    const now = Date.now();
    const notOnOrAfter = assertion.Conditions && assertion.Conditions.$ && assertion.Conditions.$.NotOnOrAfter;
    const notBefore = assertion.Conditions && assertion.Conditions.$ && assertion.Conditions.$.NotBefore;
    if(!notOnOrAfter) throw new Error("assertion has no expiry");
    const expiry = Date.parse(notOnOrAfter);
    if(!Number.isFinite(expiry) || now > expiry + SAML_CLOCK_SKEW_MS) throw new Error("assertion expired");
    if(notBefore && now + SAML_CLOCK_SKEW_MS < Date.parse(notBefore)) throw new Error("assertion not valid yet");

    // One time use
    const assertionId = assertion.$ && assertion.$.ID;
    if(!assertionId) throw new Error("assertion has no ID");
    const first = await _CACHE.getRedisInstance().set(`saml:assertion:${assertionId}`, "1", "EX", SAML_REPLAY_WINDOW_SEC, "NX");
    if(first !== "OK") throw new Error("assertion already used");

    return assertion;
}

async function mapAzureAssertion(assertion) {
    const nameId = textOf(assertion.Subject && assertion.Subject.NameID);
    if(!nameId) throw new Error("assertion has no subject");

    const attrs = asArray(assertion.AttributeStatement && assertion.AttributeStatement.Attribute);
    const get = (name) => {
        const a = attrs.find(x => x.$ && x.$.Name === name);
        return a ? textOf(a.AttributeValue) : undefined;
    };
    const CL = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/";

    const userData = {
        id: assertion.$.ID,
        userid: nameId.replace(/ /g, "_").toLowerCase(),
        tenantid: get("http://schemas.microsoft.com/identity/claims/tenantid"),
        displayname: get("http://schemas.microsoft.com/identity/claims/displayname"),
        givenname: get(CL + "givenname"),
        surname: get(CL + "surname"),
        email: get(CL + "emailaddress"),
        mobile: get(CL + "mobilephone/mobilephone") || "",

        designation: get(CL + "title/title") || "",
        department: get(CL + "department") || "",
        company: get(CL + "companyname/companyname") || "",
        office: get(CL + "office/Office") || "",

        reporting_to: get(CL + "reporting_to/reporting_to") || "",
    };

    return userData;
}
