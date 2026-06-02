/*
 * For Messaging and Notifications Controller
 * 
 * */

const nodemailer = require('nodemailer');
const { convert } = require('html-to-text');

var MESSAGING_DRIVER = {};

module.exports = {

    initialize : function() {
        addAppEventListener("messaging", function() {
            MESSAGING.loadDrivers();
        });

        MESSAGING.loadDrivers();

        console.log("\x1b[36m%s\x1b[0m","Message and Notification System Initialized");
    },

    loadDrivers: async function() {
        MESSAGING_DRIVER = {};

        MESSAGING_DRIVER['email'] = {
            "method": "sendEmail",
            "params": {
                // "sendTo": "required",
                // "subject": "required",
                // "body": "required"
            },
            "credentials": CONFIG.email || CONFIG.mail || false
        };

        //Load Messaging Vendors from DB
        if(global["VENDORS"] && typeof VENDORS.getAvailableVendors == "function") {
            const tempObj = VENDORS.getAvailableVendors("messaging");
            if(tempObj) tempObj.forEach(a=> {
                try {
                    a.credentials = JSON.parse(a.identity);
                    a.params = JSON.parse(a.required_params);
                    a.method = a.func_name;

                    MESSAGING_DRIVER[a.vendor_code] = a;
                } catch(err) {
                    console.error("MESSAGE_VENDOR_LOADING", err);
                }
            })
        }
        
        console.log("\x1b[35m%s\x1b[0m", `Loaded Messaging Drivers from Vendors - ${Object.keys(MESSAGING_DRIVER).length}`);
    },

    getDrivers: function() {
        return Object.keys(MESSAGING_DRIVER);
    },

    getParams: function(driverId) {
        return MESSAGING_DRIVER[driverId];
    },

    sendTopic: async function(topic, params, ctx) {
        return this.sendMessage(params.driver || "email", _.extend({
            topic: topic,
            useTopicDriver: true
        }, params), ctx);
    },

    sendMessageByEvent: async function(driver, params, ctx) {
        console.log("sendMessageByEvent", driver, params, ctx);
        this.sendMessage(driver, _.extend({}, payload.data || {}, payload.user || {}, payload));
    }, 

   sendMessage: async function(driver, params, ctx) {
        if(!MESSAGING_DRIVER[driver]) {
            log_error("Messaging Driver Not Supported -"+driver);
            return false;
        }

        var vStatus = VALIDATIONS.validateRule(params, MESSAGING_DRIVER[driver].params);
        if (!vStatus.status) {
            throw new LogiksError(
                "Message Validation Failed",
                400,
                "VALIDATION_ERROR",
                vStatus.errors
            );
        }

        const guid = ctx?.meta?.user?.guid || params?.user?.guid || params?.guid || "";
        const data = params.data || {};

        if(params.template_code && params.template_code.length>0) {
            const templateCode = params.template_code;
            const templateContent = await TEMPLATES.loadTemplate(templateCode, _.extend({}, data || {}, ctx?.params || {}, ctx?.data || {}, ctx?.meta || {}), ctx);
            if(templateContent) {
                params.body = templateContent.content;
                if(!params.subject || params.subject.length<2) params.subject = templateContent.subject;
            }
        } else if(params.topic && params.topic.length>0) {
            const topic = params.topic;

            const notificationObj = await _DB.db_findOne("appdb", "sys_notifications", "*", {topic: topic, blocked: "false"}, 'id DESC', true);//, guid: guid
            if(notificationObj) {
                var vStatus = VALIDATIONS.validateRule(params, notificationObj.validations_params || {});

                if (!vStatus.status) {
                    return false;
                }

                const dataObj = _.extend({}, data || {}, ctx?.params || {}, ctx?.data || {}, ctx?.meta || {});

                const uniqueTo = [...new Set((params.send_to+","+notificationObj.notify_to).split(","))];

                params.send_to = uniqueTo;
                params.cc = [...new Set((params.cc+","+notificationObj.notify_cc).split(","))];
                params.bcc = [...new Set((params.bcc+","+notificationObj.notify_bcc).split(","))];

                params.send_to = _replace(params.send_to.join(","), dataObj).split(",").filter(a=>(a!="" && a!="undefined")).join(",");
                params.cc = _replace(params.cc.join(","), dataObj).split(",").filter(a=>(a!="" && a!="undefined")).join(",");
                params.bcc = _replace(params.bcc.join(","), dataObj).split(",").filter(a=>(a!="" && a!="undefined")).join(",");

                params.body = _replace(notificationObj.body_template, dataObj);
                params.subject = _replace(notificationObj.subject, dataObj);

                params.template_code = "TOPIC:"+params.topic;

                if(params.useTopicDriver===true) driver = notificationObj.drivers;
            } else {
                return false;
            }
        } else {
            params.body = _replace(params.body, _.extend({}, data || {}, ctx?.params || {}, ctx?.data || {}, ctx?.meta || {}));
            params.subject = _replace(params.subject, _.extend({}, data || {}, ctx?.params || {}, ctx?.data || {}, ctx?.meta || {}));
        }

        const methodArr = MESSAGING_DRIVER[driver].method.split(".");
        
        if(methodArr.length<=1) {
            return MESSAGING[MESSAGING_DRIVER[driver].method](MESSAGING_DRIVER[driver].credentials, driver, params, ctx);
        } else {
            return ctx.call(MESSAGING_DRIVER[driver].method, {
                "config": MESSAGING_DRIVER[driver].credentials, driverId: driver, params, ctx
            });
        }
    },

    sendAPI: async function(driverConfig, driverId, params, ctx) {
        var vStatus = VALIDATIONS.validateRule(driverConfig, {
            "method": "required",
            "url": "required",
        });
        if (!vStatus.status) {
            throw new LogiksError(
                "Message Validation Failed",
                400,
                "VALIDATION_ERROR",
                vStatus.errors
            );
        }
console.log("MESSAGING_AXIOS_OPTIONS", driverId, driverConfig, params);
        var logData = _.extend({
            appid: ctx?.meta?.appInfo?.appid || params?.appid || "-",
            channel: "api",
            vendor: driverId, 
            template_id: params.template_code || "-", 
            sent_to: params.sendTo, 
            req_body: params.body, 
            // status: "",
            // provider_response: JSON.stringify({}), 
            retry_count: 0, 
            xtras_1: "", 
            xtras_2: "", 
            xtras_3: "", 
        }, MISC.generateDefaultDBRecord(ctx));

        try {
            const response = await axios(_.extend({}, {
                // Validate status manually
                validateStatus(status) {
                    return status >= 200 && status < 500;
                }
            }, driverConfig));

            console.log('API Call Sent:', response.status, response.headers, response.data);
            
            logData.status = "success";
            logData.provider_response = JSON.stringify({
                "status": response.status,
                "headers": response.headers,
                "response": response.data
            });
            _DB.db_insertQ1("logdb", "log_messages", logData);

            return info.response;

        } catch (error) {
            console.error("Message Sending Error:", err.message);

            if (err.response) {
                console.error("Message Sending Response:", err.response.data);
            }

            logData.status = "error";
            logData.provider_response = error.message;
            _DB.db_insertQ1("logdb", "log_messages", logData);
            return false;
        }
    },

    sendEmail: async function(driverConfig, driverId, params, ctx) {
        // driverConfig = {
        //     host: 'smtp.gmail.com',
        //     port: 587,
        //     secure: false, // true for 465, false for other ports
        //     auth: {
        //         user: 'your-email@gmail.com',
        //         pass: 'your-password',
        //     },
        // }
        var vStatus = VALIDATIONS.validateRule(params, {
            "body": "required",
            "sendTo": "required",
            "subject": "required"
        });
        if (!vStatus.status) {
            throw new LogiksError(
                "Message Validation Failed",
                400,
                "VALIDATION_ERROR",
                vStatus.errors
            );
        }

        const transporter = nodemailer.createTransport(driverConfig);
        const mailOptions = {
            from: params.send_from || driverConfig.default_from,
            to: params.sendTo,
            subject: params.subject,
            text: params.body_text || convert(params.body, { wordwrap: 130,}),
            html: params.body,
        };
        
        if(params.cc) mailOptions.cc = params.cc;
        if(params.bcc) mailOptions.bcc = params.bcc;
console.log("EMAIL_OPTIONS", driverId, mailOptions, params);
        var logData = _.extend({
            appid: ctx?.meta?.appInfo?.appid || params?.appid || "-",
            channel: "email",
            vendor: driverId, 
            template_id: params.template_code || "-", 
            sent_to: params.sendTo, 
            req_body: params.body, 
            // status: "",
            // provider_response: JSON.stringify({}), 
            retry_count: 0, 
            xtras_1: "", 
            xtras_2: "", 
            xtras_3: "", 
        }, MISC.generateDefaultDBRecord(ctx));

        // Send the email
        try {
            const info = await transporter.sendMail(mailOptions);
            // console.log('Email sent:', info);
            
            logData.status = "success";
            logData.provider_response = JSON.stringify(info);
            _DB.db_insertQ1("logdb", "log_messages", logData);

            return info.response;
        } catch (error) {
            // console.log('Error:', error);

            logData.status = "error";
            logData.provider_response = error.message;
            _DB.db_insertQ1("logdb", "log_messages", logData);
            return false;
        }
    }
}
