//Template Processing Helper
//TEMPLATES.process("", {typeo:"sql"}, {}, {}, ctx);

module.exports = {

	initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","Template Engine Initialized");
    },

    loadTemplate: async function(templateCode, data, ctx) {
        const templateObj = await _DB.db_findOne("appdb", "do_templates", "*", {template_code: templateCode, blocked: "false", guid: ctx.meta.user.guid}, {});
        if(!templateObj) throw new Error("Template not found: " + templateCode);

        if(!templateObj.params) templateObj.params = {};
        else {
            try {
                templateObj.params = JSON.parse(templateObj.params);
            } catch(err) {
                templateObj.params = {};
            }
        }
        
        var templateContent = await this.process(templateObj.template_content, templateObj.sql_source.split("\n"), data, templateObj.params, ctx);

        return {
            content: `<style>${templateObj.template_style}</style>${templateContent}`,
            subject: templateObj.subject
        };
    },

    process: async function(template, sqlSource, data = {}, params = {}, ctx) {
        if(!template) return "";

        if(!data) data = {};
        if(!params) params = {};

        if(!sqlSource) sqlSource = [];
        else if(typeof sqlSource == "object" && !Array.isArray(sqlSource)) sqlSource = [sqlSource];

        const tempDataLookup = _.extend({}, params, data, ctx?.params?ctx?.params:{}, ctx?.meta?ctx?.meta:{});

        var FINAL_DATA = {};
        _.each(sqlSource, async function(sqlObj, k) {
            const sqlQuery = await QUERY.parseQuery(sqlObj, {}, tempDataLookup);
            const dbkey = sqlQuery.dbkey?sqlQuery.dbkey:"appdb";

            const dbResponse = await _DB.db_query(dbkey, sqlQuery, {});
            const dbData = dbResponse?.results || [];

            FINAL_DATA[k] = dbData;
        });
        FINAL_DATA['DATA'] = tempDataLookup;

        return _replace(template, FINAL_DATA);
    }
}
