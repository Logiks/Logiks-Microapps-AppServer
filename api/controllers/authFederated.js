/*
 * Federated Logins Related Controller
 * */

const { parseStringPromise } = require("xml2js");

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
        const federatedLogin = await this.getFederatedLogins(appid, federatedLoginID);
        if(!federatedLogin) return false;

        return federatedLogin["guid"];
    },

    listFederatedLogins: async function(appId) {
        var whereCond = {
            "blocked": "false",
            "appid": appId
        };
        var data = await _DB.db_selectQ("appdb", "lgks_federatedlogins", "title, engine, unique_id", whereCond, {});

        if(!data || !data.results || data.results.length<=0) data = { results: [] };

        return data.results;
    },

    getFederatedLogins: async function(appId, federatedLoginID) {
        var whereCond = {
            "blocked": "false",
            "appid": appId
        };
        whereCond[`(unique_id='${federatedLoginID}' OR id='${federatedLoginID}')`] = "RAW";

        var data = await _DB.db_selectQ("appdb", "lgks_federatedlogins", "*", whereCond, {});

        if(!data || !data.results || data.results.length<=0) data = { results: [] };

        return data.results[0] || {};
    },

    getFederatedLoginEndpoint: async function(appid, federatedLoginID, ctx) {
        const federatedLogin = await this.getFederatedLogins(appid, federatedLoginID);
        if(!federatedLogin) return false;

        if(federatedLogin) {
            switch(federatedLogin.engine) {
                case "azuread2":
                    const tenantId = federatedLogin.params.tenant_id;
                    const clientId = federatedLogin.params.application_id;
                    const scope = federatedLogin.params.scope || "openid profile email offline_access User.Read";
                    
                    const returnURL = `https://${ctx.meta.serverHost}/callback/auth/${federatedLogin.unique_id}`;
                    const authURL = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${returnURL}&response_mode=query&scope=${scope}&state=secure_random`;
                    const logoutURL = `https://login.microsoftonline.com/${tenantId}/saml2`;
                    
                    return {
                        "authlink": authURL,
					    "logout": logoutURL
                    };
                case "logiksauth":
                    const baseURL = federatedLogin.params.url;
                    const appId = federatedLogin.params.appid;
                    const loginScope = federatedLogin.params.scope || "*";

                    const returnURL1 = `https://${ctx.meta.serverHost}/callback/auth/${federatedLogin.unique_id}`;// `${ctx.meta.serverHost}auth/logiksauth-login`;
                    const authURL1 = `${baseURL}authenticate?appid=${appId}&scope=${loginScope}&returnURL=${encodeURIComponent(returnURL1)}`;
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

    verifyFederatedLoginResponse: async function(appid, federatedLoginID, ctx) {
        const federatedLogin = await this.getFederatedLogins(appid, federatedLoginID);
        if(!federatedLogin) return false;

        // Implement verification logic based on the engine and response parameters
        // This is a placeholder and should be replaced with actual verification code
        switch(federatedLogin.engine) {
            case "azuread2":
                // Verify SAML response using appropriate libraries and methods
                return true; // Return true if verification is successful
            case "logiksauth":
                // Verify LogiksAuth response using appropriate libraries and methods
                return true; // Return true if verification is successful
            default:
                return false; // Unsupported engine
        }
    },

    processFederatedLoginResponse: async function(appid, federatedLoginID, ctx) {
        const federatedLogin = await this.getFederatedLogins(appid, federatedLoginID);
        if(!federatedLogin) return false;

        // console.log("processFederatedLoginResponse_1", { "params": ctx.params, "headers": ctx.headers }, federatedLogin);
        
        if(federatedLogin) {
            switch(federatedLogin.engine) {
                case "azuread2":
                    const SAMLContent = Buffer.from(ctx.params.SAMLResponse, 'base64').toString('utf-8');

                    // Convert XML → JSON
                    const parsedSAMLContent = await parseStringPromise(SAMLContent, {
                        explicitArray: false,
                        tagNameProcessors: [name => name.replace("saml:", "").replace("samlp:", "")]
                    });
                    // console.log(JSON.stringify(parsedSAMLContent, null, 2));

                    const userData = {
                        id: parsedSAMLContent.Response.$.ID,
                        userid: parsedSAMLContent.Response.Assertion.Subject.NameID._,
                        tenantid: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.microsoft.com/identity/claims/tenantid")[0]?.AttributeValue,
                        displayname: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.microsoft.com/identity/claims/displayname")[0]?.AttributeValue,
                        givenname: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname")[0]?.AttributeValue,
                        surname: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname")[0]?.AttributeValue,
                        email: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")[0]?.AttributeValue,
                        mobile: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobilephone")[0]?.AttributeValue,

                        department: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department")[0]?.AttributeValue,
                        designation: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/title/title")[0]?.AttributeValue,
                        office: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/office/Office")[0]?.AttributeValue,
                        company: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/companyname/companyname")[0]?.AttributeValue,
                    };
                    if(userData.userid) userData.userid = userData.userid.replace(/ /g,"_").toLowerCase();

                    return userData;
                case "logiksauth":
                    // return {

                    // };
            }
        }
        
        console.log("processFederatedLoginResponse_2", { "params": ctx.params, "headers": ctx.headers }, federatedLogin);

        return false;
    }
}