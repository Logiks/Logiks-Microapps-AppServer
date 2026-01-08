//Files Related API for Handling File Operations
const fs = require('fs');
const path = require('path');

/**
 * Reads a file and returns its content.
 * @param {string} filePath - The path to the file.
 * @returns {Promise<string>} - A promise that resolves with the file content.
 */
function readFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                return reject(err);
            }
            resolve(data);
        });
    });
}

module.exports = {

    initialize : function(callback) {
        console.log("\x1b[36m%s\x1b[0m","HOOKS Initialized");
    },

    searchFile: async function(guid, searchTerm) {
        const sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", {
            "guid": guid,
            "filename": [searchTerm, "LIKE"],
            "blocked": "false"
        }, {
            "limit": 10,
            "order_by": "created_at DESC"
        }, {});
        if(!sqlResult || sqlResult.length==0) return [];

        return sqlResult;
    },

    getFileInfo: async function(guid, fileId) {
        const sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", {
            "guid": guid,
            "id": fileId,
            "blocked": "false"
        }, {});
        if(!sqlResult || sqlResult.length==0) return null;

        return sqlResult[0];
    },

    // getFileContent: async function(filePath) {
    //     if(!filePath || !fs.existsSync(filePath)) {
    //         return null;
    //     }
    //     const content = await readFile(filePath);
    //     return content;
    // },

    getFileById: async function(guid, fileId, responseType = "stream", moreData = false) {
        const sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", {
            "guid": guid,
            "id": fileId,
            "blocked": "false"
        }, {});
        if(!sqlResult || sqlResult.length==0) return null;

        const filePath = path.join(UPLOADS.baseUploadFolder(), sqlResult[0].path_uri);
        const fileMime = sqlResult[0].file_mime;

        if(!filePath || !fs.existsSync(filePath)) {
            return null;
        }

        var responseObj = {};
        if(moreData) {
            responseObj = {
                folder: sqlResult[0].folder,
                year: sqlResult[0].file_year,
                metadata: sqlResult[0].metadata
            };
        }

        if(responseType=="stream") {
            const fileStream = fs.createReadStream(filePath);
            return {
                ...responseObj,
                stream: fileStream,
                mime: fileMime,
                filename: sqlResult[0].filename,
            };
        } else if(responseType=="buffer") {
            const fileBuffer = fs.readFileSync(filePath);
            return {
                ...responseObj,
                buffer: fileBuffer,
                mime: fileMime,
                filename: sqlResult[0].filename,
            };
        } else if(responseType=="content") {
            const content = await fs.readFileSync(filePath, "utf8");
            return {
                ...responseObj,
                content: content,
                mime: fileMime,
                filename: sqlResult[0].filename,
            };
        }

        return null;
    },

    getFileByPath: async function(guid, fileUri, responseType = "stream") {
        const filePath = path.join(UPLOADS.baseUploadFolder(), fileUri);
        const fileMime = sqlResult[0].file_mime;

        if(!filePath || !fs.existsSync(filePath)) {
            return null;
        }

        var responseObj = {};
        if(moreData) {
            responseObj = {
                folder: sqlResult[0].folder,
                year: sqlResult[0].file_year,
                metadata: sqlResult[0].metadata
            };
        }

        if(responseType=="stream") {
            const fileStream = fs.createReadStream(filePath);
            return {
                ...responseObj,
                stream: fileStream,
                mime: fileMime,
                filename: sqlResult[0].filename,
            };
        } else if(responseType=="buffer") {
            const fileBuffer = fs.readFileSync(filePath);
            return {
                ...responseObj,
                buffer: fileBuffer,
                mime: fileMime,
                filename: sqlResult[0].filename,
            };
        } else if(responseType=="content") {
            const content = await fs.readFileSync(filePath, "utf8");
            return {
                ...responseObj,
                content: content,
                mime: fileMime,
                filename: sqlResult[0].filename,
            };
        }

        return null;
    },

    saveFile: async function(ctx, folder, content) {
        
    }
}