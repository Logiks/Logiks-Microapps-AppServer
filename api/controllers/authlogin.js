/*
 * Federated Login Related Controller
 * */

const { parseStringPromise } = require("xml2js");

module.exports = {

    initialize: function() {
        
    },

    doFederatedLogin: async function(ctx) {
        console.log("FEDERATED_LOGIN", { "params": ctx.params, "headers": ctx.headers });
        try {
            switch(ctx.params.source) {
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
                        mobile: parsedSAMLContent.Response.Assertion.AttributeStatement.Attribute.filter(a=>a.$.Name=="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile")[0]?.AttributeValue,
                    };

                    const guid = await TENANT.resolveSSOTenant(userData.tenantid, ctx.params.source);
                    // console.log("ctx.meta.appInfo", ctx.meta.appInfo, guid);

                    const allowFederatedRegistration = ctx.meta.appInfo?.settings?.allow_federated_registration || false;
                    if(allowFederatedRegistration) {
                        const userInfo = await USERS.findOrCreateFederatedUser(userData, ctx.params.source);
                        if(!userInfo) {
                            return {
                                "status": "error",
                                "message": "Error in creating/finding federated user, contact admin"
                            }
                        }

                        return {
                            "status": "success",
                            "user": userInfo
                        }
                    } else {
                        const userInfo = await USERS.getUserInfo(userData.userid, {guid: guid})
                        if(!userInfo) {
                            return {
                                "status": "error",
                                "message": "Error in creating/finding federated user, contact admin"
                            }
                        }
                        
                        return {
                            "status": "success",
                            "user": userInfo
                        }
                    }
                    break;
                default:
                    return {
                        "status": "error",
                        "message": "Federated login for " + ctx.params.source + " is not yet implemented"
                    }
            }
        } catch(e) {
            console.error("Error in federated login", e);
            return {
                "status": "error",
                "message": "Error in federated login: " + e.message
            }
        }
    }
}