//Files Related API for Handling File Operations
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const { fileTypeFromBuffer } = require('file-type');
const mime = require('mime-types');

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
        if(!sqlResult || sqlResult?.results.length==0) return null;

        return sqlResult;
    },

    getFileInfo: async function(guid, fileId) {
        const sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", {
            "guid": guid,
            "id": fileId,
            "blocked": "false"
        }, {});
        if(!sqlResult || sqlResult?.results.length==0) return null;

        return sqlResult[0];
    },

    // getFileContent: async function(filePath) {
    //     if(!filePath || !fs.existsSync(filePath)) {
    //         return null;
    //     }
    //     const content = await readFile(filePath);
    //     return content;
    // },

    publishFile: async function(guid, fileId, expiresOn, ctx) {
        var sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", {
            "guid": guid,
            "id": fileId,
            "blocked": "false"
        }, {});
        if(!sqlResult || sqlResult?.results.length==0) return false;

        var ext = sqlResult.results[0].filename.split(".");
        ext = ext[ext.length-1];

        var dated = moment().format("Y-MM-DD HH:mm:ss");
        const fileURI = `${UNIQUEID.generate(8)}.${ext}`;

        const insertResponse = await _DB.db_insertQ1("appdb", "files_published", {
                    "guid": guid,
                    "file_id": fileId,
                    "uri": fileURI,
                    "filename": sqlResult.results[0].filename,
                    "expires": expiresOn,
                    "created_on": dated,
                    "created_by": ctx?ctx.meta.user.userId:"",
                    "edited_on": dated,
                    "edited_by": ctx?ctx.meta.user.userId:"",
                });
        if(insertResponse) return `${CONFIG.base_url || ctx.meta.serverHost}api/public/files/${fileURI}?exp=${expiresOn}`;
        else return false;
    },

    getFilePublished: async function(fileURI, responseType = "stream", moreData = false) {
        var sqlResult = await _DB.db_selectQ("appdb", "files_published", "*", {
            "uri": fileURI,
            "blocked": "false"
        }, {});
        if(!sqlResult || !sqlResult.results || sqlResult?.results.length==0) return false;

        const fileInfo = sqlResult.results[0];
        return FILES.getFileById(fileInfo.guid, fileInfo.file_id, responseType, moreData);
    },

    getFileById: async function(guid, fileId, responseType = "stream", moreData = false) {
        var sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", {
            "guid": guid,
            "id": fileId,
            "blocked": "false"
        }, {});
        if(!sqlResult || sqlResult?.results.length==0) return null;
        
        sqlResult = sqlResult.results[0];

        const fileMime = sqlResult.file_mime;

        const responseContent = await UPLOADS.resolveFileObj(sqlResult, responseType);
        
        var responseObj = {};
        if(moreData) {
            responseObj = {
                folder: sqlResult.folder,
                year: sqlResult.file_year,
                metadata: sqlResult.metadata
            };
        }

        if(responseContent.responseType=="stream") {
            return {
                ...responseObj,
                stream: responseContent.response,
                mime: fileMime,
                filename: sqlResult.filename,
                responseType: responseType
            };
        } else if(responseType=="buffer") {
            return {
                ...responseObj,
                buffer: responseContent.response,
                mime: fileMime,
                filename: sqlResult.filename,
                responseType: responseType
            };
        } else if(responseType=="content") {
            return {
                ...responseObj,
                content: responseContent.response,
                mime: fileMime,
                filename: sqlResult.filename,
                responseType: responseType
            };
        }

        return null;
    },

    getFileByPath: async function(guid, fileUri, responseType = "stream") {
        const filePath = path.join(UPLOADS.baseUploadFolder(), fileUri);
        const fileMime = sqlResult[0].file_mime;
        // const fileMime = mime.lookup(filePath);

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
        const uploadDir = await UPLOADS.getDestinyPath(folder, "", true);
        const uploadDir1 = await UPLOADS.getDestinyPath(folder, "", false);

        const tempPath = await universalFileSave(uploadDir, content, {});
        var ext = tempPath.split(".");
        ext = ext[ext.length-1];
        const mimetype = mime.lookup(tempPath);
        const fileName = path.basename(tempPath);//ctx?.params?.filename || "file_"+moment().format("YMD_Hms")+"."+ext;

        const fileInfo = await UPLOADS.moveUploadedFile(ctx, {
            "path": tempPath,
            "bucket": folder,
            "filename": fileName,
            "mimetype": mimetype || "application/octet-stream",
            "size": fs.statSync(tempPath).size,
        });
        fs.rm(tempPath);
        fileInfo.path = tempPath.replace(uploadDir, uploadDir1);
        return {
            "status": "success",
            "fileId": fileInfo[tempPath],
            "name": fileName,
            "mime": mimetype, 
            "size": 0, 
            "path": tempPath.replace(uploadDir, uploadDir1).replace(UPLOADS.baseUploadFolder(), "")
        };
    }
}



/**
 * Production Grade Universal File Saver
 *
 * Supports:
 *  - Plain text
 *  - Base64
 *  - Data URI base64
 *  - Buffers
 *  - Binary data
 *  - Readable streams
 *  - multer
 *  - formidable
 *  - express-fileupload
 *  - arbitrary uploaded file objects
 *  - huge files using streams
 *
 * @param {Object} ctx
 * @param {String} folder
 * @param {*} content
 * @param {Object} options
 *
 * @returns {Promise<Object>}
 * Returns:
 *   final absolute file path
 */
async function universalFileSave(folder, content, options = {}) {

    const config = {
        filename: null,
        extension: null,
        maxSize: 1024 * 1024 * 1024 * 10, // 10GB
        detectMime: true,
        allowOverwrite: false,
        defaultExtension: 'bin',
        tempExtension: '.tmp',
        ...options
    };

    if (!folder) {
        throw new Error('Folder is required');
    }

    await fs.promises.mkdir(folder, { recursive: true });

    const id = crypto.randomUUID();

    let mime = 'application/octet-stream';
    let ext = config.defaultExtension;

    let filename =
        config.filename ||
        `${id}.${ext}`;

    let filepath = path.resolve(
        path.join(folder, filename)
    );

    // ---------------------------------------------------------
    // HELPERS
    // ---------------------------------------------------------

    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    }

    function isReadableStream(obj) {
        return obj &&
            typeof obj.pipe === 'function' &&
            typeof obj.on === 'function';
    }

    function isBase64(str) {

        if (!str || typeof str !== 'string') {
            return false;
        }

        const cleaned = str.replace(/\s/g, '');

        return (
            cleaned.length % 4 === 0 &&
            /^[A-Za-z0-9+/]+=*$/.test(cleaned)
        );
    }

    async function finalizeFile(tempPath) {

        const stats = await fs.promises.stat(tempPath);

        if (stats.size > config.maxSize) {
            await fs.promises.unlink(tempPath);
            throw new Error('File exceeds maximum size');
        }

        // Detect actual mime/ext
        if (config.detectMime) {

            try {

                const fd = await fs.promises.open(tempPath, 'r');

                const buffer = Buffer.alloc(4100);

                await fd.read(buffer, 0, 4100, 0);

                await fd.close();

                const detected = await fileTypeFromBuffer(buffer);

                if (detected) {
                    mime = detected.mime;
                    ext = detected.ext;
                }

            } catch (e) {
                // ignore detection failure
            }
        }

        // Override extension if manually provided
        if (config.extension) {
            ext = config.extension.replace('.', '');
        }

        // Preserve original filename if given
        if (config.filename) {

            const originalExt =
                path.extname(config.filename);

            if (originalExt) {

                filename = sanitizeFilename(
                    config.filename
                );

            } else {

                filename = sanitizeFilename(
                    `${config.filename}.${ext}`
                );
            }

        } else {

            filename = `${id}.${ext}`;
        }

        filepath = path.resolve(
            path.join(folder, filename)
        );

        if (
            !config.allowOverwrite &&
            fs.existsSync(filepath)
        ) {
            throw new Error(
                `File already exists: ${filepath}`
            );
        }

        await fs.promises.rename(
            tempPath,
            filepath
        );

        return filepath;
    }

    async function saveBuffer(buffer) {

        const tempPath = path.join(
            folder,
            `${id}${config.tempExtension}`
        );

        await fs.promises.writeFile(
            tempPath,
            buffer
        );

        return finalizeFile(tempPath);
    }

    async function saveStream(stream) {

        const tempPath = path.join(
            folder,
            `${id}${config.tempExtension}`
        );

        let total = 0;

        const limiter = new Transform({

            transform(chunk, encoding, callback) {

                total += chunk.length;

                if (total > config.maxSize) {
                    callback(
                        new Error(
                            'File exceeds maximum size'
                        )
                    );
                    return;
                }

                callback(null, chunk);
            }
        });

        await pipeline(
            stream,
            limiter,
            fs.createWriteStream(tempPath)
        );

        return finalizeFile(tempPath);
    }

    async function saveBase64(base64String) {

        const cleaned = base64String.replace(/\s/g, '');

        // Small/medium base64
        if (cleaned.length < 50 * 1024 * 1024) {

            const buffer = Buffer.from(
                cleaned,
                'base64'
            );

            return saveBuffer(buffer);
        }

        // Huge base64 -> stream decode
        const tempPath = path.join(
            folder,
            `${id}${config.tempExtension}`
        );

        const decode = new Transform({

            transform(chunk, encoding, callback) {

                try {

                    const decoded = Buffer.from(
                        chunk.toString(),
                        'base64'
                    );

                    callback(null, decoded);

                } catch (e) {
                    callback(e);
                }
            }
        });

        await pipeline(
            Readable.from([cleaned]),
            decode,
            fs.createWriteStream(tempPath)
        );

        return finalizeFile(tempPath);
    }

    // ---------------------------------------------------------
    // BUFFER
    // ---------------------------------------------------------

    if (Buffer.isBuffer(content)) {
        return saveBuffer(content);
    }

    // ---------------------------------------------------------
    // STREAM
    // ---------------------------------------------------------

    if (isReadableStream(content)) {
        return saveStream(content);
    }

    // ---------------------------------------------------------
    // FILE OBJECTS
    // ---------------------------------------------------------

    if (content && typeof content === 'object') {

        // multer
        if (content.buffer) {

            mime = content.mimetype || mime;

            if (content.originalname) {
                config.filename =
                    content.originalname;
            }

            return saveBuffer(content.buffer);
        }

        // formidable / temp file
        if (content.filepath || content.path) {

            const sourcePath =
                content.filepath ||
                content.path;

            mime =
                content.mimetype ||
                content.type ||
                mime;

            if (
                content.originalFilename ||
                content.name
            ) {
                config.filename =
                    content.originalFilename ||
                    content.name;
            }

            return saveStream(
                fs.createReadStream(sourcePath)
            );
        }

        // express-fileupload
        if (typeof content.mv === 'function') {

            const tempPath = path.join(
                folder,
                `${id}${config.tempExtension}`
            );

            await content.mv(tempPath);

            mime =
                content.mimetype ||
                mime;

            if (content.name) {
                config.filename =
                    content.name;
            }

            return finalizeFile(tempPath);
        }

        // generic stream wrapper
        if (content.stream) {

            mime =
                content.mimetype ||
                content.type ||
                mime;

            if (
                content.filename ||
                content.name
            ) {
                config.filename =
                    content.filename ||
                    content.name;
            }

            return saveStream(
                content.stream
            );
        }
    }

    // ---------------------------------------------------------
    // STRING
    // ---------------------------------------------------------

    if (typeof content === 'string') {

        // Data URI
        const dataUri = content.match(
            /^data:(.+?);base64,(.+)$/s
        );

        if (dataUri) {

            mime = dataUri[1];

            return saveBase64(
                dataUri[2]
            );
        }

        // Raw base64
        if (isBase64(content)) {
            return saveBase64(content);
        }

        // Plain text
        mime = 'text/plain';

        if (!config.extension) {
            ext = 'txt';
        }

        return saveBuffer(
            Buffer.from(
                content,
                'utf8'
            )
        );
    }

    // ---------------------------------------------------------
    // UNSUPPORTED
    // ---------------------------------------------------------

    throw new Error(
        'Unsupported content type'
    );
}