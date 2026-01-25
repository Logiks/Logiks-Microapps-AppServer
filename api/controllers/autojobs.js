/*
 * MicroService Controller
 * 
 * */

const cron = require('node-cron');

const LOADED_JOBS = {};
const ACTIVE_JOBS = [];
const LOADED_PLUGINS = {};

module.exports = {

    initialize : async function() {
        try {
            fs.mkdirSync(CONFIG.ROOT_PATH+'/misc/automators',true);
        } catch(e) {
            //ignore
        }
        return true;
    },

    //Delay the job loading to allow system to stabilize
    startJobs: async function() {
        // setTimeout(async function() {
            
        // }, 5000);

        await this.loadJobs();

        console.log("\x1b[34m%s\x1b[0m", `\nAutoJobs Initialized With-${Object.keys(ACTIVE_JOBS).length}/${Object.keys(LOADED_JOBS).length} Active/Loaded Jobs`);
    },

    reloadAllJobs: async function() {
        //Deactivate all active jobs
        for(var i=0; i<ACTIVE_JOBS.length; i++) {
            const jobId = ACTIVE_JOBS[i];
            AUTOJOBS.deactivateJob(jobId);
        }
        ACTIVE_JOBS.splice(0, ACTIVE_JOBS.length);

        //Clear loaded jobs and plugins
        for(var k in LOADED_JOBS) {
            delete LOADED_JOBS[k];
        }
        for(var k in LOADED_PLUGINS) {
            delete LOADED_PLUGINS[k];
        }

        //Reload Jobs
        await this.loadJobs();

        console.log("\x1b[31m%s\x1b[0m", `\nAutoJobs Reloaded With-${Object.keys(ACTIVE_JOBS).length}/${Object.keys(LOADED_JOBS).length} Active/Loaded Jobs`);
    },

    loadJobs: async function() {
        if(fs.existsSync(CONFIG.ROOT_PATH+'/misc/automators')) {
            fs.readdirSync(CONFIG.ROOT_PATH+'/misc/automators/').forEach(function(file) {
                    if ((file.indexOf(".js") > 0 && (file.indexOf(".js") + 3 == file.length))) {
                        var className = file.toLowerCase().replace(".js", "").toUpperCase();
                        var filePath = path.resolve(CONFIG.ROOT_PATH+'/misc/automators/' + file);

                        LOADED_PLUGINS[className] = require(filePath);
                        // console.log(">>>", className, filePath, LOADED_PLUGINS);

                        if(LOADED_PLUGINS[className].initialize!=null && typeof LOADED_PLUGINS[className].initialize==="function") {
                            LOADED_PLUGINS[className].initialize();
                        }
                    }
                });
        }

        const allJobs = await getAllJobs();
        _.each(allJobs, function(conf, k) {
            if(conf.schedule==null) {
                console.log("\x1b[31m%s\x1b[0m","\nAutoJobs Schedule Not Found or Not Supported - Skipping Job:", conf.name);
                return;
            }
            try {
                conf.params = JSON.parse(conf.params||"{}");
            } catch(e) {
                conf.params = {};
            }
            conf.active = true;//(conf.active=="true"?true:false);
            conf.job_id = `${conf.name}_${conf.id}`;
            // console.log("AUTOJOBS_JOB", conf, k);

            if(conf.active) {
                const job = cron.schedule(conf.schedule, () => {
                    runJobNow(conf);
                });

                LOADED_JOBS[`${conf.name}_${conf.id}`] = {
                    "job_id": `${conf.name}_${conf.id}`,
                    "config": conf,
                    "job": job,
                    "started": moment().format(),
                    "status": (conf.active?"active":"inactive"),
                };
                ACTIVE_JOBS.push(`${conf.name}_${conf.id}`);
            } else {
                LOADED_JOBS[`${conf.name}_${conf.id}`] = {
                    "job_id": `${conf.name}_${conf.id}`,
                    "config": conf,
                    "job": false,
                    "started": moment().format(),
                    "status": (conf.active?"active":"inactive"),
                };
            }
        });

        // console.log("LOADED_PLUGINS", LOADED_PLUGINS);
        // console.log("LOADED_JOBS", LOADED_JOBS);
        // console.log("ACTIVE_JOBS", ACTIVE_JOBS);
    },

    getActiveJobs: async function() {
        return ACTIVE_JOBS;
    },

    getLoadedJobs: async function() {
        return Object.keys(LOADED_JOBS);
    },

    activateJob: async function(jobId) {
        if(ACTIVE_JOBS.indexOf(jobId)<0) {
            if(!LOADED_JOBS[jobId]) return false;
            
            const conf = LOADED_JOBS[jobId].config;
            const job = cron.schedule(conf.schedule, () => {
                runJobNow(conf);
            });

            LOADED_JOBS[jobId].job = job;
            LOADED_JOBS[jobId].status = "active";
            ACTIVE_JOBS.push(jobId);
            return true;
        } else {
            return true;
        }
    },

    deactivateJob: async function(jobId) {
        if(ACTIVE_JOBS.indexOf(jobId)>=0) {
            LOADED_JOBS[jobId].job.stop();
            LOADED_JOBS[jobId].job = false;
            LOADED_JOBS[jobId].status = "inactive";
            const idx = ACTIVE_JOBS.indexOf(jobId);
            ACTIVE_JOBS.splice(idx, 1);
            return true;
        } else {
            return true;
        }
    },

    registerNewJob: async function(jobConfig) {
        return false;
    },
    
    runJobNow(jobConfig, userId) {
        if(jobConfig.guid==null) return false;
        return runJobNow(jobConfig, userId);
    }
}

async function runJobNow(jobConfig, userId = "system") {
    console.log("\x1b[32m%s\x1b[0m", "\nAutoJobs Running Job -", jobConfig.name);//jobConfig
    
    const ctx = await SERVER.getBroker();

    switch (jobConfig.job_type) {
        case "method":
            try {
                var response = await ctx.call(jobConfig.job_script, jobConfig.params);
                if(!response) {
                    log_jobrun(jobConfig, jobConfig.params, response, "FAILED", `JOB Failed at Running`, userId);
                    return false;
                } else {
                    log_jobrun(jobConfig, jobConfig.params, response, "SUCCESS", `JOB Ran Successfully`, userId);
                    return true;
                }
            } catch(e) {
                log_jobrun(jobConfig, jobConfig.params, {}, "ERROR", "JOB Run Error - "+e.message, userId);
                return false;
            }
            break;
        case "plugin":
            if(LOADED_PLUGINS[jobConfig.job_script] && LOADED_PLUGINS[jobConfig.job_script].runJob!=null && typeof LOADED_PLUGINS[jobConfig.job_script].runJob==="function") {
                var response = await LOADED_PLUGINS[jobConfig.job_script].runJob(jobConfig.params, userId);
                if(!response) {
                    log_jobrun(jobConfig, jobConfig.params, response, "FAILED", `JOB Plugin Failed at Running`, userId);
                    return false;
                } else {
                    log_jobrun(jobConfig, jobConfig.params, response, "SUCCESS", `JOB Plugin Ran Successfully`, userId);
                    return true;
                }
            } else {
                log_jobrun(jobConfig, jobConfig.params, response, "FAILED", `JOB Plugin Not Found or corrupt - ${jobConfig.job_script}`, userId);
                return false;
            }
            return true;
            break;
        case "rest":
            var response = await axios.request(jobConfig.params);
            if(!response) {
                log_jobrun(jobConfig, jobConfig.params, response, "FAILED", `JOB REST API Failed at Running`, userId);
                return false;
            } else {
                log_jobrun(jobConfig, jobConfig.params, response, "SUCCESS", `JOB REST API Ran Successfully`, userId);
                return true;
            }
            break;
        case "script":
            try {
                var response = eval(jobConfig.job_script, jobConfig.params);
                if(!response) {
                    log_jobrun(jobConfig, jobConfig.params, response, "FAILED", `JOB Script Failed at Running`, userId);
                    return false;
                } else {
                    log_jobrun(jobConfig, jobConfig.params, response, "SUCCESS", `JOB Script Ran Successfully`, userId);
                    return true;
                }
            } catch(e) {
                log_jobrun(jobConfig, jobConfig.params, response, "ERROR", "JOB Script Error - "+e.message, userId);
                return false;
            }
            break;
        default:
            log_jobrun(jobConfig, {}, {}, "ERROR", "JOB_TYPE Not Supported - "+jobConfig.job_type, userId);
            return false;
    }
    
}

function log_jobrun(jobConfig, payload, response, status, details="", userId = "system") {
    var dated = moment().format("Y-M-D HH:mm:ss");
    if(typeof response==="string") response = [response];

    var logData = {
        "guid": jobConfig.guid,
        "appid": "",

        "worker_id": jobConfig.worker_id?jobConfig.worker_id:jobConfig.job_id,
        "job_id": jobConfig.id,
        "job_type": jobConfig.job_type,
        "job_name": jobConfig.name,
        "status": status,
        "details": (status.toLowerCase()!="error"?details:""),

        "payload": (payload?JSON.stringify(payload):""),
        "response": (response?JSON.stringify(response):""),
        "error_message": (status.toLowerCase()!="success"?details:""),

        "started_at": dated,
        "finished_at": dated,
        "attempts": 1,

        "created_on": dated,
        "created_by": userId,
        "edited_on": dated,
        "edited_by": userId
    };

    _DB.db_insertQ1("logdb", "log_autojobs", logData);

    if(jobConfig.run_only_once=="true" || jobConfig.run_only_once===true) {
        AUTOJOBS.deactivateJob(jobConfig.job_id);

        _DB.db_updateQ("appdb", "lgks_autojobs", {
            "retired": "true",
            "last_ran": moment().format(),
        }, {"id": jobConfig.id});
    } else{
        _DB.db_updateQ("appdb", "lgks_autojobs", {
            "last_ran": moment().format(),
        }, {"id": jobConfig.id});
    }
}

async function getAllJobs(pluginId) {
    var whereCond = {
        "blocked": "false",
        "retired": "false",
    };
    if(pluginId!=null) {
        whereCond.plugin = pluginId;
    }

    var jobData = await _DB.db_selectQ("appdb", "lgks_autojobs", "*", whereCond, {});
    if(jobData===false || !jobData.results || jobData.results.length<=0) {
        jobData = {results:[]};
    }

    return jobData.results;
}