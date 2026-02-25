//Misc Helper Functions

const sha1 = require('sha1');
const { v4: uuidv4 } = require('uuid');

module.exports = {

  initialize: function() {
    console.log("\x1b[36m%s\x1b[0m","Misc Attributes and Supporting Methods Initialized");
  },

  getEnv: function() {
    return process.env.NODE_ENV?process.env.NODE_ENV.toUpperCase():"DEV";
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

  executeFunctionByName: async function(functionName, dataParams, ctx) {
    const func = global[functionName];
    const functionArr = functionName.split(".");

    if (typeof func === "function") {
      return func(dataParams, ctx);
    } else if(global[functionArr[0]] && typeof global[functionArr[0]][functionArr[1]] === "object") {
      return global[functionArr[0]][functionArr[1]](dataParams, ctx);
    } else {
      return ctx.call(functionName, dataParams);
    }
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

  isHTTPS: function(ctx) {
    const isHttps =
        ctx.meta.headers?.["x-forwarded-proto"] === "https" ||
        ctx.meta.headers?.["x-forwarded-ssl"] === "on" ||
        ctx.meta.headers?.["forwarded"]?.includes("proto=https") ||
        ctx.meta.protocol === "https";

    return isHttps;
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
      if(dataObj.userId!=null) {
        dataObj.created_by = dataObj.userId;
      }
      if(dataObj.geocordinates!=null) {
        dataObj.geolocation = dataObj.geocordinates;
      }
      return _.pickBy(dataObj, function(value, key) {
                      return (["geolocation","clientip","medium","site","host","created_by"].indexOf(key)>=0);
                    }, {});
  },

  generateDefaultDBRecord : function(ctx, forUpdate = false) {
    var dated = moment().format("Y-MM-DD HH:mm:ss");
    // console.log("generateDefaultDBRecord", ctx.meta.user);
    if(forUpdate) {
      return {
        "edited_on": dated,
        "edited_by": ctx.meta?.user?.userId || "-",
      };
    } else {
      return {
        "guid": ctx?.meta?.user?.guid || "-",
        "created_on": dated,
        "created_by": ctx?.meta?.user?.userId || "-",
        "edited_on": dated,
        "edited_by": ctx?.meta?.user?.userId || "-",
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
  },

  geoDistanceMeters: function(g1, g2) {
    const [lat1, lon1] = g1.split(",").map(Number);
    const [lat2, lon2] = g2.split(",").map(Number);

    const R = 6371000;
    const toRad = d => d * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
  },

  _replaceObj: function(jsonObj, ctx) {
    if(!jsonObj) return {};
    try {
        var tempJSON = JSON.stringify(jsonObj);
        tempJSON = _replaceCtx(tempJSON, ctx)
        tempJSON = JSON.parse(tempJSON);

        return tempJSON;
    } catch(e) {
        return jsonObj;
    }
  },

  _replace: function(text, data, strict = false) {
    return _replace(text, data, strict);
  },

  _replaceCtx: function(text, ctx, strict = false) {
    return _replaceCtx(text, ctx, strict);
  }
}

global._replaceCtx = function(text, ctx, strict = false) {
  return _replace(text, _.extend({}, ctx?.params || {}, ctx?.meta || {}));
}

global._replace = function(text, data, strict = false) {
  if(data==null) data = {};
  
  return text
    //For variables with ${}
    .replace(/\$\{([^}]+)\}/g, (match, key) => {
        if(key.substr(0,1)=="$") {//for json path
            var result = JSONPath({path: key.substr(2), json: data});
            if(Array.isArray(result)) result = result.join(",");
            // console.log("JSON_PATH", key, key.substr(2), result);
            return result;
        }
        if(!data.data) data.data = {};
        if(strict) return data[key] || data?.data[key] || "";
        else return data[key] || data?.data[key] || match;
    })
    //For variables with {{}}
    .replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        if(key.substr(0,1)=="$") {//for json path
            var result = JSONPath({path: key.substr(2), json: data});
            if(Array.isArray(result)) result = result.join(",");
            //console.log("JSON_PATH", key, key.substr(2), result);
            return result;
        }
        if(!data.data) data.data = {};
        if(strict) return data[key] || data?.data[key] || "";
        else return data[key] || data?.data[key] || match;
    })
    //For variables with ##
    .replace(/#([^#]+)#/g, (match, key) => {//#([^}]+)#
        if(key.substr(0,1)=="$") {//for json path
            var result = JSONPath({path: key.substr(2), json: data});
            if(Array.isArray(result)) result = result.join(",");
            //console.log("JSON_PATH", key, key.substr(2), result);
            return result;
        }
        if(!data.data) data.data = {};
        if(strict) return data[key] || data?.data[key] || "";
        else return data[key] || data?.data[key] || match;
    });
}

global.convertToValidatorRules = function(schema, mode="edit") {
  const rules = {};

  for (const field in schema) {
    const config = schema[field];
    const ruleParts = [];

    if(mode!=field.vmode) {//mode=="create" && field.vmode="edit"
      continue;
    }
    if(field.vmode=="view") {
      continue;
    }

    // Required rule
    if (config.required === true) {
      ruleParts.push("required");
    } else {
      //ruleParts.push("nullable");
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

    if(ruleParts.length>0) rules[field] = ruleParts.join("|");
  }

  return rules;
}

global.is_numeric  = function(value) {
  return typeof value === 'number' ||
    (typeof value === 'string' &&
     value.trim() !== '' &&
     !isNaN(value));
}

global.is_float = function(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    !Number.isInteger(value)
  );
}