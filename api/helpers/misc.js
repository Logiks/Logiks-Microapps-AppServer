//Misc Helper Functions

const sha1 = require('sha1');
const { v4: uuidv4 } = require('uuid');

module.exports = {

  initialize: function() {
    console.log("\x1b[36m%s\x1b[0m","Misc Attributes and Supporting Methods Initialized");
  },

  slugify : function(text) {
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with -
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
      .replace(/\-\-+/g, '-')         // Replace multiple - with single -
      .replace(/^-+/, '')             // Trim - from start of text
      .replace(/-+$/, '');            // Trim - from end of text
  },

  toTitle : function(str) {
    return str.toLowerCase().replace(/\b[a-z]/g, function(letter) {
        return letter.toUpperCase();
      });
  },

  urlify : function(jsonObject) {
    let urlParameters = Object.entries(jsonObject).map(e => e.join('=')).join('&');
    return urlParameters;
  },
    
  getDebugInfo : function(ctx, req, res) {
    return {
        "RUNNING_SINCE":moment(server.config.START_TIME).fromNow(),
        "DEBUG": CONFIG.debug,
        "AUDIT": CONFIG.audit,
        "PATH": req.path(),
        "URL": req.href(),
        "QUERY": req.getQuery(),
        "BODY": req.body,
        "QUERY": req.query,
        "PARAMS": req.params,
        "HEADERS": req.headers,
        "GUID":req.get("GUID"),
        // "DEVID":req.body.devid,

        // "CONNECT": CONNECTPARAMS
      };
  },

  generateHash : function(content) {
    if(typeof content == "object") return sha1(JSON.stringify(content));
    return sha1(content);
  },

  generateUUID : function(prefix,n) {
    //Math.ceil(Math.random()*10000000)+"-"+uuidv4();
    //return Math.random(1000000);
    if(n==null) n = 8;
    var add = 1, max = 12 - add;

    if (n > max) {
      return generate(max) + generate(n - max);
    }

    max = Math.pow(10, n + add);
    var min = max / 10; // Math.pow(10, n) basically 
    var number = Math.floor(Math.random() * (max - min + 1)) + min;

    return prefix+sha1(("" + number).substring(add)+uuidv4()+moment().format("Y-M-DTHH:mm:ss"));
  },

  timeStamp : function() {
    return moment().format("Y-M-D HH:mm:ss");
  },

  getClientIP : function(req) {
    const xfwd = req.headers["x-forwarded-for"];
    if (xfwd) return xfwd.split(",")[0].trim();
    return req.connection.remoteAddress || req.socket.remoteAddress || "0.0.0.0";
  },

  // coarse IP block for hijack detection (e.g., 192.168.1.*)
  getIpBlock : function(ip) {
    if (!ip) return "unknown";
    const parts = ip.split(":").pop().split("."); // handle IPv6-mapped IPv4
    if (parts.length < 2) return ip;
    return parts.slice(0, 2).join("."); // /16 style
  },


  getAdditionalParams : function(dataObj) {
      if(dataObj.userid!=null) {
        dataObj.created_by = dataObj.userid;
      }
      if(dataObj.geocordinates!=null) {
        dataObj.geolocation = dataObj.geocordinates;
      }
      return _.pickBy(dataObj, function(value, key) {
                      return (["geolocation","clientip","medium","site","host","created_by"].indexOf(key)>=0);
                    }, {});
  },

  generateDefaultDBRecord : function(ctx, forUpdate = false) {
    var dated = moment().format("Y-M-D HH:mm:ss");
    // console.log("generateDefaultDBRecord", ctx.meta.user);
    if(forUpdate) {
      return {
        "edited_on": dated,
        "edited_by": ctx.meta.user.userId,
      };
    } else {
      return {
        "guid": ctx.meta.user.guid,
        "created_on": dated,
        "created_by": ctx.meta.user.userId,
        "edited_on": dated,
        "edited_by": ctx.meta.user.userId,
      };
    }
  },

  processUpdateQueryFromBody : function(ctx, tableName, whereCond, extraFields = "edited_on=?") {
    var dated = moment().format("Y-M-D HH:mm:ss");
    
    var strUpdate = [];
    _.each(ctx.params.fields, function(a,b) {
      strUpdate.push(b+'=?');
    });
    var strSQL = "UPDATE "+tableName+" SET "+strUpdate.join(", ")+","+extraFields+" WHERE "+whereCond;
    
    var dataValues = Object.values(ctx.params.fields);
    
    if(extraFields == "edited_on=?") {
      dataValues.push(dated);
    }
    
    return {
      "sql" : strSQL,
      "data" : dataValues
    };
  }
}

global._replace = function(text, data, strict = false) {
  return text
    //For variables
    .replace(/\$\{([^}]+)\}/g, (match, key) => {
        if(key.substr(0,1)=="$") {//for json path
            var result = JSONPath({path: key.substr(2), json: data});
            if(Array.isArray(result)) result = result.join(",");
            // console.log("JSON_PATH", key, key.substr(2), result);
            return result;
        }
        if(strict) return data[key] || data.data[key] || "";
        else return data[key] || data.data[key] || match;
    })
    .replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        if(key.substr(0,1)=="$") {//for json path
            var result = JSONPath({path: key.substr(2), json: data});
            if(Array.isArray(result)) result = result.join(",");
            //console.log("JSON_PATH", key, key.substr(2), result);
            return result;
        }
        if(strict) return data[key] || data.data[key] || "";
        else return data[key] || data.data[key] || match;
    });
}

global.convertToValidatorRules = function(schema) {
  const rules = {};

  for (const field in schema) {
    const config = schema[field];
    const ruleParts = [];

    // Required rule
    if (config.required === true) {
      ruleParts.push("required");
    } else {
      // ruleParts.push("nullable");
    }

    // Type-based rules
    // if (config.type === "dataSelector") {
    //   if (config.groupid === "boolean") {
    //     ruleParts.push("boolean");
    //   } 
    //   else if (config.groupid === "country") {
    //     // Typically country could be a string or numeric ID
    //     ruleParts.push("string");
    //     ruleParts.push("min:2");
    //   } 
    //   else {
    //     ruleParts.push("string");
    //   }
    // } 
    // else {
    //   ruleParts.push("string");
    // }

    // Custom validations
    if (config.validation) {
      switch (config.validation) {
        case "mobile":
          // Change this as per your country rules
          ruleParts.push("regex:/^[6-9]\\d{9}$/");
          break;

        case "email":
          ruleParts.push("email");
          break;

        case "numeric":
          ruleParts.push("numeric");
          break;

        default:
          ruleParts.push(config.validation);
      }
    }

    rules[field] = ruleParts.join("|");
  }

  return rules;
}