/*
 * For Messaging and Notifications Controller
 * 
 * */

const nodemailer = require('nodemailer');
const { convert } = require('html-to-text');

var MESSAGING_DRIVER = {};

module.exports = {

    initialize : function() {
        this.loadDrivers();

        //Load Messaging Vendors from DB

        console.log("\x1b[36m%s\x1b[0m","Message and Notification System Initialized");
    },

    loadDrivers: async function() {
        MESSAGING_DRIVER['email'] = {
            "method": "sendEmail",
            "params": {
                "sendTo": "required",
                "subject": "required",
                "body": "required"
            },
            "credentials": CONFIG.email || CONFIG.mail || false
        };
    },

    getDrivers: function() {
        return Object.keys(MESSAGING_DRIVER);
    },

    getParams: function(driverId) {
        return MESSAGING_DRIVER[driverId];
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
        const methodArr = MESSAGING_DRIVER[driver].method.split(".");
        
        if(methodArr.length<=1) {
            return MESSAGING[MESSAGING_DRIVER[driver].method](MESSAGING_DRIVER[driver].credentials, driver, params, ctx);
        } else {
            return ctx.call(MESSAGING_DRIVER[driver].method, {
                "config": MESSAGING_DRIVER[driver].credentials, driverId: driver, params, ctx
            });
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

        if(params.template_code && params.template_code.length>0) {
            const templateCode = params.template_code;
            const data = params.data || {};
            const templateContent = await TEMPLATES.loadTemplate(templateCode, data, ctx);

            params.body = templateContent.content;
            if(!params.subject || params.subject.length<2) params.subject = templateContent.subject;
        } else {
            params.body = _replace(params.body, _.extend({}, ctx.params, ctx.meta));
        }

        const transporter = nodemailer.createTransport(driverConfig);
        const mailOptions = {
            from: params.send_from || driverConfig.default_from,
            to: params.sendTo,
            subject: params.subject,
            text: params.body_text || convert(params.body, { wordwrap: 130,}),
            html: params.body,
        };
        
        var logData = _.extend({
            appid: ctx.meta.appInfo.appid,
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
