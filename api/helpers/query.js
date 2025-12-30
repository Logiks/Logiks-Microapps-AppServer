/*
 * for supporting Logiks Query Style Json to SQL Query conversion
 * 
 * */

var DB_DRIVERS = {};
const BASE_DRIVER_DIR = __dirname+'/drivers/';

const QUERYMAP = _CACHE.getCacheMap("QUERYMAP");

module.exports = {

    initialize : function() {
        
        //Load all drivers
        // fs.readdirSync(BASE_DRIVER_DIR).forEach(function(file) {
        //     if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
        //         var filePath = path.resolve(BASE_DRIVER_DIR + file);
        //         var clsName = file.replace('.js','').toUpperCase();

        //         DB_DRIVERS[clsName] = require(filePath);

        //         // if(typeof global[clsName].initialize === "function") {
        //         // 	try {
        //         // 		global[clsName].initialize();
        //         // 	} catch(e) {
        //         // 		console.error("Error Initializing Controller "+clsName, e.message);
        //         // 	}
        //         // }
        //     }
        // });

        console.log("\x1b[36m%s\x1b[0m","Query Engine Initialized");
    },

    processMetaInfo: async function(metaInfo) {
        return await generateEnvObj(metaInfo);
    },

    updateWhereFromEnv: function(whereObj, metaInfo) {
        if(!whereObj) return whereObj;
        //console.log("updateWhereFromEnv", whereObj, metaInfo);
        if(typeof whereObj == "string") {
            return _replace(whereObj, metaInfo);
        } else if(Array.isArray(whereObj)) {
            _.each(whereObj, function(arrObj,k) {
                _.each(arrObj, function(v, k1) {
                    try {
                        if(v.toUpperCase()=="RAW") {
                            whereObj[k][_replace(k1, metaInfo)] = "RAW";
                        } else if(typeof v == "string") {
                            whereObj[k][k1] = _replace(v, metaInfo);
                        }
                    } catch(e) {
                        console.error(e);
                    }
                })
            })
        } else if(typeof whereObj=="object") {
            _.each(whereObj, function(v,k) {
                try {
                    if(v.toUpperCase()=="RAW") {
                        whereObj[_replace(k, metaInfo)] = "RAW";
                    } else if(typeof v == "string") {
                        whereObj[k] = _replace(v, metaInfo);
                    }
                } catch(e) {
                    console.error(e);
                }
            })
        }

        return whereObj;
    },

    storeQuery : async function(queryObj, userObj, queryID = false) {
        if(!queryID) queryID = UNIQUEID.generate(12);

        QUERYMAP[queryID] = queryObj;
        _CACHE.saveCacheMap("QUERYMAP", QUERYMAP);

        return queryID;
    },

    getQueryByID: async function(queryID, userObj) {
        if(!QUERYMAP[queryID]) return false;
        return QUERYMAP[queryID];
    },

    parseQuery : async function(sqlObj, filter = {}, metaInfo = {}) {
        if(sqlObj==null) {
            console.error("No JSON Query Found");
            return false;
        }

        //Prepare MetaInfo
        metaInfo = await QUERY.processMetaInfo(metaInfo);

        //Pre-Process sqlObj
        if(typeof sqlObj == "string") {
            try {
                sqlObj = JSON.parse(sqlObj);
            } catch(e) {
                console.error("Invalid JSON Query String", e);
                return false;
            }
        }

        var columnsStr = "*";
        var limit = 1000;
        var offset = 0;
        var groupby = false;
        var orderby = false;
        var having = false;

        if(!sqlObj.column && sqlObj.cols) sqlObj.column = sqlObj.cols;

        if (Array.isArray(sqlObj.column)) {
            columnsStr = sqlObj.column
                .map((a) => {
                    return processTilde(a);
                })
                .join(", ");
        }
        else {
            columnsStr = processTilde(sqlObj.column);
        }

        if (sqlObj.limit) {
            limit = sqlObj.limit;
        }
        if (sqlObj.offset) {
            offset = sqlObj.offset;
        }

        if (sqlObj.orderby) {
            orderby = sqlObj.orderby;
        }

        if (sqlObj.groupby) {
            groupby = sqlObj.groupby;
        }

        if (sqlObj.having) {
            having = sqlObj.having;
        }

        if (!limit || limit == null || limit.length <= 0) {
            limit = process.env.MAX_RECORDS;
        }
        
        //Prepare final SQL String
        var sql = `SELECT ${columnsStr} FROM ${sqlObj.table} `;

        //Handle sqlObj.join
        if(sqlObj.join && Array.isArray(sqlObj.join)) {
            _.each(sqlObj.join, function(sqlSingleObj, k) {
                const query = sqlSingleObj.query;
                const condition = sqlSingleObj.condition;
                const as = sqlSingleObj.as?sqlSingleObj.as:"";

                switch(sqlSingleObj.type) {
                    case "INNER":
                        sql += ` INNER JOIN (${query}) ${as} ON ${condition}`;
                        break;
                    case "RIGHT":
                        sql += ` RIGHT JOIN (${query}) ${as} ON ${condition}`;
                        break;
                    case "LEFT":
                    default:
                        sql += ` LEFT JOIN (${query}) ${as} ON ${condition}`;
                        break;
                }
            });
        }
        
        //Handle sqlObj.table_connection

        var WHERE_ADDED = false;
        if(!filter) filter = {};

        filter = QUERY.updateWhereFromEnv(filter, metaInfo);
        sqlObj.where = QUERY.updateWhereFromEnv(sqlObj.where, metaInfo);
        sqlObj.filter = QUERY.updateWhereFromEnv(sqlObj.filter, metaInfo);

        if(typeof sqlObj.where == "string") {
            sqlObj.where = processTilde(sqlObj.where);
        } else {
            var temp = {};
            _.each(sqlObj.where, function(k,v) {
                temp[processTilde(v)] = processTilde(k);
            });
            sqlObj.where = temp;
        }

        
        sqlObj.where = _.extend(sqlObj.where, filter);

        var sqlWhere = processSQLWhere(sqlObj.where, " ");
        // console.log("sqlWhere", sqlWhere);
        if (sqlWhere.length > 0) {
            sqlWhere = sqlWhere.replace(/``/g, "`");
            sql += " WHERE " + sqlWhere;
            WHERE_ADDED = true;
        }

        if(typeof sqlObj.filter == "string") {
            sqlObj.filter = processTilde(sqlObj.filter);
        } else {
            var temp = {};
            _.each(sqlObj.filter, function(k,v) {
                temp[processTilde(v)] = processTilde(k);
            });
            sqlObj.filter = temp;
        }

        var sqlWhere = processSQLWhere(sqlObj.filter, " ");
        if (sqlWhere.length > 0) {
            sqlWhere = sqlWhere.replace(/``/g, "`");
            if (WHERE_ADDED) sql += " AND " + sqlWhere;
            else sql += " WHERE " + sqlWhere;

            WHERE_ADDED = true;
        }

        // if(is_array(sqlObj.obj['groupby'])) {
        //     if(isset(sqlObj.obj['groupby']['group'])) {
        //         group=sqlObj.obj['groupby']['group'];
        //     }
        //     if(isset(sqlObj.obj['groupby']['having'])) {
        //         having=sqlObj.obj['groupby']['having'];
        //     }
        // }

        if (groupby && groupby.length > 0) {
            groupby = processTilde(groupby);
            sql += ` GROUP BY ${groupby}`;
        }
        if (having && having.length > 0) {
            having = processTilde(having);
            sql += ` HAVING ${having}`;
        }

        if (orderby && orderby.length > 0) {
            var direction = "DESC";
            if (orderby.indexOf(" DESC") > 0) {
                orderby = orderby.replace(" DESC", "");
            } else if (orderby.indexOf(" ASC") > 0) {
                direction = "ASC";
                orderby = orderby.replace(" ASC", "");
            } else if (orderby.indexOf(" desc") > 0) {
                orderby = orderby.replace(" desc", "");
            } else if (orderby.indexOf(" asc") > 0) {
                direction = "ASC";
                orderby = orderby.replace(" asc", "");
            }

            orderby = processTilde(orderby);
            sql += ` ORDER BY ${orderby} ${direction}`;
        }

        if (limit != null && limit > 0) {
            if (offset == null) {
                offset = 0;
            }
            sql += ` LIMIT ${offset}, ${limit}`;
        }

        sql = sql.replaceAll(/('')+/g,"'");
        sql = sql.replaceAll(/('')+/g,"'");

        console.log("SQLOBJECT", sqlObj, sql);

        return sql;
    }
}


function processTilde(str) {
    if(str==null || typeof str != "string") return str;
    var a1 = str;
    var k1 = 0;
    // while(a1.indexOf("`")>=0) {
    //     // console.log(k1, a1);
    //     if(k1%2==0)
    //         a1 = a1.replace("`", "[");
    //     else
    //         a1 = a1.replace("`", "]");
    //     k1++;
    // }
    const regex = /( as )[a-zA-Z0-9_-]+/gm;
    a1 = a1.replace(regex, function(k,v) {
        var t = k.replace(" as ", "").trim();
        return ` as '${t}'`;
    })
    // console.log(">", a1);
    return a1;
};


function processSQLWhere (sqlWhereObj, colDelimiter = "`", whereJoiner = "AND") {
    if (sqlWhereObj == null || colDelimiter.length <= 0) {
        return "";
    }
    if(typeof sqlWhereObj == "string") {
        var temp = {};
        temp[sqlWhereObj] = "RAW";
        sqlWhereObj = temp;
    }

    if (colDelimiter.length == 1)
        colDelimiter = [colDelimiter, colDelimiter];
    else if (typeof colDelimiter == "string")
        colDelimiter = colDelimiter.split("");

    var sqlWhere = [];
    if (typeof sqlWhereObj == "object" && !Array.isArray(sqlWhereObj)) {
        _.each(sqlWhereObj, function (a, b) {
            if (a == "RAW") {
                sqlWhere.push(b);
            } else if (Array.isArray(a) && a.length == 2) {
                // sqlWhere.push(b + a[1] + "'" + a[0] + "'");
                sqlWhere.push(parseRelation(b, a, colDelimiter));
            } else if (["~", "!", "@", "#"].indexOf(a[0]) >= 0) {
                sqlWhere.push(parseRelation(b, a, colDelimiter));
            } else {
                b = b.replace(/`/g, "");
                sqlWhere.push(
                    `${colDelimiter[0]}${b}${colDelimiter[1]}` +
                        "='" +
                        a +
                        "'"
                );
            }
        });
    } else {
        sqlWhere.push(sqlWhereObj);
    }

    return sqlWhere.join(` ${whereJoiner} `);
};

function parseRelation (col, arr, colDelimiter = ["`", "`"]) {
    col = col.replace(/`/g, "");
    // console.log("SQLWHERE_PARSER", col, arr);
    if (typeof arr == "string") {
        if (["~", "^", "!", "@", "#"].indexOf(arr[0]) >= 0) {
            switch (arr[0]) {
                case "^":
                    arr = {
                        OP: "SW",
                        VALUE: arr.substr(1),
                    };
                    break;
                case "!":
                case "~":
                    arr = {
                        OP: "NE",
                        VALUE: arr.substr(1),
                    };
                    break;
                case "@":
                    arr = {
                        OP: "FIND",
                        VALUE: arr.substr(1),
                    };
                    break;
                case "#":
                    arr = {
                        OP: "LIKE",
                        VALUE: arr.substr(1),
                    };
                    break;

                default:
                    arr = arr.substr(1);
                    return `\`${col}\`='${arr}'`;
                    break;
            }
        } else {
            return "`${col}`=" + sqlData(arr);
        }
    }

    if (arr.VALUE != null) arr[0] = arr.VALUE;
    if (arr.OP != null) arr[1] = arr.OP;

    if (arr[1] == null) arr[1] = "=";

    // console.log("SQLWHERE_PARSER_2", col, arr);
    //col = `\`${col}\``;
    col = `${colDelimiter[0]}${col}${colDelimiter[1]}`;
    var s = "";
    switch (arr[1].toLowerCase()) {
        case "eq":
        case ":eq:":
        case "=":
            arr[0] = sqlData(arr[0]);
            s = `${col}=${arr[0]}`;
            break;

        case "ne":
        case ":ne:":
        case "neq":
        case ":neq:":
        case "<>":
            arr[0] = sqlData(arr[0]);
            s = `${col}<>${arr[0]}`;
            break;

        case "lt":
        case ":lt:":
        case "<":
            arr[0] = sqlData(arr[0]);
            s = `${col}<${arr[0]}`;
            break;

        case "le":
        case ":le:":
        case "lte":
        case ":lte:":
        case "<=":
            arr[0] = sqlData(arr[0]);
            s = `${col}<=${arr[0]}`;
            break;

        case "gt":
        case ":gt:":
        case ">":
            arr[0] = sqlData(arr[0]);
            s = `${col}>${arr[0]}`;
            break;

        case "ge":
        case ":ge:":
        case "gte":
        case ":gte:":
        case ">=":
            arr[0] = sqlData(arr[0]);
            s = `${col}>=${arr[0]}`;
            break;

        case "nn":
        case ":nn:":
            s = `${col} IS NOT NULL`;
            break;

        case "nu":
        case ":nu:":
            s = `${col} IS NULL`;
            break;

        case "bw":
        case ":bw:":
        case "sw":
        case ":sw:":
        case "starts":
            s = `${col} LIKE '${arr[0]}%'`;
            break;

        case "bn":
        case ":bn:":
        case "sn":
        case ":sn:":
            s = `${col} NOT LIKE '${arr[0]}%'`;
            break;

        case "lw":
        case ":lw:":
        case "ew":
        case ":ew:":
        case "ends":
            s = `${col} LIKE '%${arr[0]}'`;
            break;

        case "ln":
        case ":ln:":
        case "en":
        case ":en:":
            s = `${col} NOT LIKE '%${arr[0]}'`;
            break;

        case "cw":
        case ":cw:":
        case "between":
        case "like":
            s = `${col} LIKE '%${arr[0]}%'`;
            break;

        case "cn":
        case ":cn:":
        case "notbetween":
        case "notlike":
            s = `${col} NOT LIKE '%${arr[0]}%'`;
            break;

        case "s":
        case ":s:":
        case "find":
        case ":find:":
            s = `FIND_IN_SET('${arr[0]}',${col})`;
            break;

        case "in":
        case ":in:":
            if (typeof arr[0] == "object") {
                _.each(arr[0], function (b, a) {
                    arr[0][a] = `'${b}'`;
                });
                s = `${col} IN (` + arr[0].join(",") + `)`;
            } else if (isNaN(arr[0])) {
                if (
                    arr[0].substr(0, 1) == "'" ||
                    arr[0].substr(0, 1) == '"'
                ) {
                    s = `${col} IN (${arr[0]})`;
                } else if (onlyNumbers(arr[0].split(","))) {
                    s = `${col} IN (${arr[0]})`;
                } else {
                    s = `${col} IN ('${arr[0]}')`;
                }
            } else {
                s = `${col} IN (${arr[0]})`;
            }
            break;

        case "ni":
        case ":ni:":
            if (typeof arr[0] == "object") {
                _.each(arr[0], function (b, a) {
                    arr[0][a] = `'${b}'`;
                });
                s = `${col} NOT IN (` + arr[0].join(",") + `)`;
            } else if (isNaN(arr[0])) {
                if (
                    arr[0].substr(0, 1) == "'" ||
                    arr[0].substr(0, 1) == '"'
                ) {
                    s = `${col} NOT IN (${arr[0]})`;
                } else if (onlyNumbers(arr[0].split(","))) {
                    s = `${col} NOT IN (${arr[0]})`;
                } else {
                    s = `${col} NOT IN ('${arr[0]}')`;
                }
            } else {
                s = `${col} NOT IN (${arr[0]})`;
            }
            break;

        case "range":
            if (typeof arr[0] == "object") {
                if (is_numeric(arr[0][0]) || is_float(arr[0][0])) {
                    s = `${col} BETWEEN ${arr[0][0]} AND ${arr[0][1]}`;
                } else {
                    s = `${col} BETWEEN '${arr[0][0]}' AND '${arr[0][1]}'`;
                }
            } else {
                if (arr[0].indexOf(",") > 0) {
                    var x1 = arr[0].split(",");
                    s = `${col} BETWEEN ${x1[0]} AND ${x1[1]}`;
                } else s = `${col} BETWEEN ${arr[0]}`;
            }
            break;
        case "rangestr":
            if (typeof arr[0] == "object") {
                s = `${col} BETWEEN '${arr[0][0]}' AND '${arr[0][1]}'`;
            } else {
                if (arr[0].indexOf(",") > 0) {
                    var x1 = arr[0].split(",");
                    s = `${col} BETWEEN '${x1[0]}' AND '${x1[1]}'`;
                } else s = `${col} BETWEEN ${arr[0]}`;
            }
            break;

        default:
            arr[0] = sqlData(arr[0]);
            s = `${col} ${arr[0]}`;
    }
    return s;
};

function sqlDataArr (arr, sqlType = "*") {
    _.each(arr, function (b, a) {
        arr[a] = sqlData(b, sqlType);
    });
    return arr;
};

function sqlData (str, sqlType = "*") {
    if (Array.isArray(str)) {
        str = str.join(",");
    }

    str = cleanSQL(str);

    if (str.length <= 0) return "";

    if (sqlType == "*" || sqlType == "auto") {
        if (str == "TRUE" || str == "FALSE") return strtoupper(str);
        else if (str === true || str === false)
            return str === true ? "TRUE" : "FALSE";
        else if (typeof str == "number") return str;
        else if (typeof str == "boolean") return str;
        else if (str.substr(0, 1) == "0") return `'${str}'`;
        // elseif(strlen(str)==10 && preg_match("/\d{2}\-\d{2}-\d{4}/",str_replace("/","-",str)) && strlen(str)=="10") return "'"._date(str)."'";
        else if (str.indexOf("()") > 1) return str;
        else if (str == "..") return `''`;
        return `'${str}'`;
    } else if (
        sqlType == "int" ||
        sqlType == "float" ||
        sqlType == "bool"
    ) {
        if (strlen($s) <= 0) return "0";
        else return str;
    } else if (sqlType == "date") {
        str = _date(str);
        return `'${str}'`;
    } else if (sqlType == "func") {
        return str;
    } else {
        return `'${str}'`;
    }
};

function cleanSQL (str) {
    return str;
};
function _date (str) {
    return new moment(str).format("YYYY-MM-DD");
};

function _datetime (str) {
    return new moment(str).format("YYYY-MM-DD HH:mm:ss");
};

function onlyNumbers(array) {
    array = array.map((a) => (isNaN(parseFloat(a)) ? a : parseFloat(a)));
    return array.every((element) => {
        return typeof element === "number";
    });
};

function detectDataType(input, defaultValue) {
    if(defaultValue==null || defaultValue=="string") defaultValue = "varchar";

    // Check for Boolean
    if (input.toLowerCase() === "true" || input.toLowerCase() === "false") {
        return "bool";
    }

    // Check for Integer
    if (!isNaN(input) && parseInt(input) == input && input.indexOf('.') === -1) {
        return "int";
    }

    // Check for Float
    if (!isNaN(input) && parseFloat(input) == input) {
        return "float";
    }

    if(input.substr(0,1)=="{" && input.substr(input.length-1,1)=="}") {
        try {
            JSON.parse(input);
            return "json";
        } catch(e) {}
    }

    // Default to String
    return defaultValue;
}

async function generateEnvObj(metaInfo) {
    if(metaInfo['META_PROCESSED']===true) return metaInfo;

    var newMeta = _.cloneDeep(metaInfo);

    const newUser = await USERS.getUserData(newMeta.sessionId);

    newMeta["SESS_LOGIN_TIME"] = newMeta.user.timestamp;

    newMeta["SESS_GUID"] = newUser.guid;
    newMeta["SESS_USER_ID"] = newUser.userId;
    newMeta["SESS_USERID"] = newUser.userId;
    newMeta["USERID"] = newUser.userId;
    newMeta["SESS_TENANT_ID"] = newUser.tenantId;
    newMeta["SESS_USER_NAME"] = newUser.username;
    newMeta["SESS_USER_MOBILE"] = newUser.mobile;
    newMeta["SESS_USER_CELL"] = newMeta["SESS_USER_MOBILE"];
    newMeta["SESS_USER_EMAIL"] = newUser.email;
    newMeta["SESS_USER_COUNTRY"] = newUser.country;
    newMeta["SESS_USER_ZIPCODE"] = newUser.zipcode;
    newMeta["SESS_USER_GEOLOC"] = newUser.geolocation;
    newMeta["SESS_USER_AVATAR"] = newUser.avatar?newUser.avatar:"";

    newMeta["SESS_ACCESS_ID"] = newUser.access?.id;
    newMeta["SESS_ACCESS_NAME"] = newUser.access?.name;
    newMeta["SESS_ACCESS_SITES"] = newUser.access?.sites;
    
    newMeta["SESS_PRIVILEGE_ID"] = newUser.privilege?.id;
    newMeta["SESS_PRIVILEGE_NAME"] = newUser.privilege?.name;
    newMeta["SESS_PRIVILEGE_HASH"] = newUser.privilege?.hash;

    newMeta["SESS_GROUP_ID"] = newUser.group?.id;
    newMeta["SESS_GROUP_NAME"] = newUser.group?.name;
    newMeta["SESS_GROUP_MANAGER"] = newUser.group?.manager;
    // newMeta["SESS_GROUP_DESCS"] = newUser.group?.groupDescs;

    newMeta["SESS_ACTIVE_SITE"] = newMeta.appInfo.appid;
    newMeta["SESS_LOGIN_SITE"] = newMeta.appInfo.appid;
    newMeta["SESS_SITEID"] = newMeta.appInfo.appid;
    // newMeta["ADMIN_PRIVILEGE_RANGE"] = "";

    newMeta["SESS_CURRENT_DATE"] = moment().format("Y-M-D");
    newMeta["SESS_CURRENT_DATE_DMY"] = moment().format("D-M-Y");
    newMeta["SESS_CURRENT_DATETIME"] = moment().format("Y-M-D HH:mm:ss");
    newMeta["SESS_CURRENT_DAY"] = moment().format("D");
    newMeta["SESS_CURRENT_DAYNAME"] = moment().format("dddd");
    newMeta["SESS_CURRENT_MONTH"] = moment().format("M");
    newMeta["SESS_CURRENT_MONTH_NAME"] = moment().format("MMMM");
    newMeta["SESS_CURRENT_TIME"] = moment().format("HH:mm:ss");
    newMeta["SESS_CURRENT_YEAR"] = moment().format("Y");
    newMeta["SESS_DATE_YESTERDAY"] = moment().subtract(1, 'days').format("Y-M-D");

    // newMeta["SESS_PROFILE_ID"] = newUser.profile.id;
    // newMeta["SESS_PROFILE_CODE"] = newUser.profile.code;
    // newMeta["SESS_PROFILE_DESIGNATION"] = newUser.profile.designation;
    // newMeta["SESS_PROFILE_SUBTYPE"] = newUser.profile.subtype;
    // newMeta["SESS_REPORTING_TO"] = newUser.profile.reporting_to;
    // newMeta["SESS_REPORTING_TO_HR"] = newUser.profile.reporting_to_hr;

    // newMeta["SESS_BRANCH_ID"] = newUser.branch.id;
    // newMeta["SESS_BRANCH_CODE"] = newUser.branch.code;
    // newMeta["SESS_BRANCH_NAME"] = newUser.branch.name;

    newMeta["SESS_POLICY"] = {};
    newMeta["SESS_ROLE_LIST"] = newUser.roles;
    newMeta["SESS_SCOPE_LIST"] = newUser.scopes;

    newMeta["SESS_GEOLOCATION"] = newMeta.geolocation?newMeta.geolocation:newUser.geolocation;
    newMeta["GEOLOCATION"] = newMeta["SESS_GEOLOCATION"];
    newMeta["CLIENT_IP"] = newMeta.remoteIP;
    newMeta["SERVER_IP"] =  newMeta.serverIP?newMeta.serverIP:newMeta.serverHost;
    
    newMeta['META_PROCESSED'] = true;

    console.log("META_INFO", newMeta);

    return newMeta;
}