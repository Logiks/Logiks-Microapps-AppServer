//VectorGateway Integration Layer for AICore

//Sources
// Vector Gateway
// MySQL Search - full text search
// Local RAG

module.exports = {

    constructor(params = {}) {
        this.params = params;
        // console.log(">>>> KNOWLEDGE");
    },

    search: async function(guid, stext, cypher = false, filter = {}, params = {}, top_n = 5) {
        return [];
    },

    //filePath = can be id of files_tbl, or path wrt to root path of installation or complete path or URL
    extract: async function(guid, filePath) {

    }
}