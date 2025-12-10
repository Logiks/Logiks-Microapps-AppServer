/*
 * Application Controller
 * 
 * */

const APP_DIR = `misc/apps/`;

module.exports = {

    initialize : function() {

    },

    getAppList: function() {
        var appList = fs.readdirSync(APP_DIR);
        appList = appList.filter(a=>(a.substr(0,1)!="." && ["z", "x", "temp"].indexOf(a.split("_"))<0));

        return appList;
    },

    getAppInfo: async function(appId) {
        return await BASEAPP.getAppInfo(appId);
    }
}
