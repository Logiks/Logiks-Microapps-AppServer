/*
 * File Upload Handler
 * 
 * */

const multer = require("multer");
const fs = require("fs-extra");
const fs1 = require("fs");

const TEMP_UPLOAD_ROOT = process.env.UPLOAD_TEMP || path.resolve(ROOT_PATH+`/${CONFIG.storage.temp_path || "temp"}/`);
const BASE_UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(ROOT_PATH+`/${CONFIG.storage.base_path || "uploads"}/`);

fs.ensureDir(TEMP_UPLOAD_ROOT);
fs.ensureDir(BASE_UPLOAD_ROOT);

/* ---------------- STORAGE ENGINE ---------------- */

const storage = multer.diskStorage({
	async destination(req, file, cb) {
		try {
			// user selected base folder
			const userFolder = req.query.folder || "default";

			// keep original folder structure
			const relativePath = file.webkitRelativePath || file.originalname;
			
			const uploadDir = await UPLOADS.getDestinyPath(userFolder, relativePath, true);

			cb(null, uploadDir);
		} catch (err) {
			cb(err);
		}
	},

	filename(req, file, cb) {
		const unique = UNIQUEID.generate(10);
		cb(null, `${unique}_${sanitizeFileName(file.originalname)}`);
	}
});

/* Security controls */
const uploadHandler = multer({
	storage,
	limits: { fileSize: CONFIG.storage.max_size || 100 * 1024 * 1024 }, // 100MB
	fileFilter(req, file, cb) {
		if(isBlockedExtension(sanitizeFileName(file.originalname))) {
			return cb(new Error("File type not allowed"));
		}
		cb(null, true);
	}
});

module.exports = {

    initialize: function() {

    },

    baseUploadFolder: function() {
        return BASE_UPLOAD_ROOT;
    },

	tempUploadFolder: function() {
        return TEMP_UPLOAD_ROOT;
    },

    // filePath comes from request data; it must resolve inside the upload root
    getTargetPath: function(filePath, isEncrypted = false) {
        const root = path.resolve(BASE_UPLOAD_ROOT);
        const target = path.resolve(root, String(filePath) + (isEncrypted?".enc":""));
        if(target !== root && !target.startsWith(root + path.sep)) {
            throw new Error("Invalid file path");
        }
        return target;
    },

    sanitizeFileName: sanitizeFileName,

    sanitizePathSegment: sanitizePathSegment,

    isBlockedExtension: isBlockedExtension,

    getUploadHandler: function() {
        return uploadHandler;
    },

    getDestinyPath: async function(userFolder, relativePathWithFileName, isTemp = false) {
		const year = moment().format("Y");
		const month = moment().format("M").padStart(2, "0");

		// every segment is sanitized; the last part of the relative path is the file name, so it is dropped
		const folderParts = String(userFolder || "").split(/[\\/]+/).map(sanitizePathSegment).filter(Boolean);
		const relativeParts = String(relativePathWithFileName || "").split(/[\\/]+/).slice(0, -1).map(sanitizePathSegment).filter(Boolean);

		if(folderParts.length==0) folderParts.push("default");

		const root = path.resolve(isTemp?TEMP_UPLOAD_ROOT:BASE_UPLOAD_ROOT);
		const uploadDir = path.resolve(root, ...folderParts, year.toString(), month, ...relativeParts);

		if(uploadDir !== root && !uploadDir.startsWith(root + path.sep)) {
			throw new Error("Invalid upload folder");
		}

		await fs.ensureDir(uploadDir);

		return uploadDir;
    },

	//Log all uploaded files into files_tbl
    moveUploadedFile: async function(ctx, fileArray) {
		// const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
		// console.log("moveUploadedFile", ctx, fileArray);
        
		if(!ctx.params.meta) ctx.params.meta = {};
		else {
			try {
				ctx.params.meta = JSON.parse(ctx.params.meta);
			} catch(e) {
				ctx.params.meta = {};
			}
		}

        // CONFIG.log_sql = true;
		var result = {};

		if(Array.isArray(fileArray)) {
			for(var i=0;i<fileArray.length;i++) {
				var encryptFile = false;
				const file = fileArray[i];

				var bucket = file.bucket?file.bucket:(ctx.params.bucket?ctx.params.bucket:"default");

				//when to encrypt
				if(CONFIG?.storage?.encrypted && (CONFIG.storage.encrypted=="*" || CONFIG.storage.encrypted.indexOf(bucket)>=0)) {
					encryptFile = true;
				}

				const fileURI = await move_to_store(file.path, file.filename, file.bucket || bucket, encryptFile);
				if(!fileURI) {
					result[file.path] = 0;
					continue;
				}

				const sqlResult = await _DB.db_insertQ1("appdb", "files_tbl", _.extend({
					"guid": ctx.meta.user.guid,
					"appid": ctx.meta.appInfo.appid,

					"filename": sanitizeFileName(ctx.params.filename?ctx.params.filename:file.filename),
					"folder": bucket,
					"path_uri": fileURI.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, ""),
					"file_mime": file.mimetype,
					"file_size": file.size,
					"file_year": new moment().format("Y"),
					"metadata": ctx.params.meta?(typeof ctx.params.meta == "object"? JSON.stringify(ctx.params.meta):""): "{}",
					"driver": CONFIG.storage.driver,
					"processed": "false",
					"encrypted": encryptFile?"true":"false",
					"flags": "",
				}, MISC.generateDefaultDBRecord(ctx, false)));

				// console.log("XXXXX", sqlResult.insertId);
				
				result[file.path] = sqlResult.insertId?sqlResult.insertId:0;

				SERVER.getBroker().emit("files.create", {"id": sqlResult.insertId, "bucket": bucket, "user": ctx?.meta?.user || {}});
				//result[fileURI.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, "")] = sqlResult.insertId?sqlResult.insertId:0;
			}
		} else {
			var encryptFile = false;
			const file = fileArray;

			var bucket = file.bucket?file.bucket:(ctx.params.bucket?ctx.params.bucket:"default");

			//when to encrypt
			if(CONFIG?.storage?.encrypted && (CONFIG.storage.encrypted=="*" || CONFIG.storage.encrypted.indexOf(bucket)>=0)) {
				encryptFile = true;
			}

			const fileURI = await move_to_store(file.path, file.filename, bucket, encryptFile);
			if(!fileURI) {
				result[file.path] = 0;
			} else {
				const sqlResult = await _DB.db_insertQ1("appdb", "files_tbl", _.extend({
					"guid": ctx.meta.user.guid,
					"appid": ctx.meta.appInfo.appid,

					"filename": sanitizeFileName(file.filename),
					"folder": bucket,
					"path_uri": fileURI.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, ""),
					"file_mime": file.mimetype,
					"file_size": file.size,
					"file_year": new moment().format("Y"),
					"metadata": ctx.params.meta?(typeof ctx.params.meta == "object"? JSON.stringify(ctx.params.meta):""): "{}",
					"driver": CONFIG.storage.driver,
					"processed": "false",
					"encrypted": encryptFile?"true":"false",
					"flags": "",
				}, MISC.generateDefaultDBRecord(ctx, false)));

				// console.log("XXXXX", sqlResult.insertId);

				result[file.path] = sqlResult.insertId?sqlResult.insertId:0;
				
				SERVER.getBroker().emit("files.create", {"id": sqlResult.insertId, "bucket": bucket, "user": ctx?.meta?.user || {}});
				// result[fileURI.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, "")] = sqlResult.insertId?sqlResult.insertId:0;
			}
		}

		return result;
    },

	resolveFileObj: async function(fileObj, responseType = "stream", isEncrypted = false) {
		return get_from_store(fileObj, responseType, isEncrypted);
	},

	fileExists: async function(filePath, isEncrypted = false) {
		const fileObj = {
			path_uri: filePath,
			driver: CONFIG.storage.driver
		};
		return await check_in_store(fileObj, isEncrypted);
	}
}

async function check_in_store(fileObj, isEncrypted = false) {
	if(!fileObj.driver) fileObj.driver = CONFIG.storage.driver;

	//CONFIG.storage.encrypt
	
	switch (fileObj.driver) {
		case "local":
			const filePath = path.join(UPLOADS.baseUploadFolder(), fileObj.path_uri);
			
			if(!filePath || !fs.existsSync(filePath)) {
				return false;
			}
			if(fileObj.encrypted===true || fileObj.encrypted==="true") {
				isEncrypted = true;
			}
			return fs.existsSync(filePath);
			break;
	
		case "miniio":
			return null;
			break;

		case "docqdrive":
			return null;
			break;
		
		case "s3":
			return null;
			break;
		
		case "azureobjects":
			return null;
			break;

		default:
			console.log("File Storage Driver Not Supported", CONFIG.storage.driver);
			return false;
			break;
	}
}

async function get_from_store(fileObj, responseType = "stream", isEncrypted = false) {
	if(!fileObj.driver) fileObj.driver = CONFIG.storage.driver;

	//CONFIG.storage.encrypt
	
	switch (fileObj.driver) {
		case "local":
			const filePath = path.join(UPLOADS.baseUploadFolder(), fileObj.path_uri);
			
			if(!filePath || !fs.existsSync(filePath)) {
				return null;
			}
			if(fileObj.encrypted===true || fileObj.encrypted==="true") {
				isEncrypted = true;
			}
			var decryptedStream = null;
			if(isEncrypted) {
				decryptedStream = ENCRYPTER.decryptStream(fs.createReadStream(filePath), CONFIG.storage.encrypt_key || CONFIG.SALT_KEY);
			} else {
				decryptedStream = fs.createReadStream(filePath);
			}
			if(responseType=="stream") {
				return {
					response: decryptedStream,
					responseType: responseType
				};
			} else if(responseType=="buffer") {
				return {
					response: await streamToBuffer(decryptedStream),
					responseType: responseType
				}
			} else if(responseType=="content") {
				return {
					response: await streamToString(decryptedStream),
					responseType: responseType
				}
			} else {
				return {
					response: await streamToString(decryptedStream),
					responseType: responseType
				}
			}
			break;
	
		case "miniio":
			return null;
			break;

		case "docqdrive":
			return null;
			break;
		
		case "s3":
			return null;
			break;
		
		case "azureobjects":
			return null;
			break;

		default:
			console.log("File Storage Driver Not Supported", CONFIG.storage.driver);
			return false;
			break;
	}
}

async function move_to_store(tempFilePath, fileName, bucket, encrypt = false) {
	// console.log("XXXXXXX", CONFIG.storage, tempFilePath, fileName, bucket);

	//Encrypt File
	if(encrypt) {
		const encryptedPath = await ENCRYPTER.encryptFile(tempFilePath, CONFIG.storage.encrypt_key || CONFIG.SALT_KEY);
		fs.unlinkSync(tempFilePath);
		tempFilePath = encryptedPath;
	}

	switch (CONFIG.storage.driver) {
		case "local":
			return local_storage(tempFilePath, fileName, bucket);
			break;
	
		case "miniio":
			return miniio_storage(tempFilePath, fileName, bucket);
			break;

		case "docqdrive":
			return docqdrive_storage(tempFilePath, fileName, bucket);
			break;
		
		case "s3":
			return s3_storage(tempFilePath, fileName, bucket);
			break;
		
		case "azureobjects":
			return azureobjects_storage(tempFilePath, fileName, bucket);
			break;

		default:
			console.log("File Storage Driver Not Supported", CONFIG.storage.driver);
			return false;
			break;
	}
}

async function local_storage(tempFilePath, fileName, bucket = "default") {
	if(CONFIG.storage.driver!="local") return false;
	// const params = CONFIG.storage.params;

	await fs.ensureDir(BASE_UPLOAD_ROOT);

	const newFilePath = tempFilePath.replace(TEMP_UPLOAD_ROOT, BASE_UPLOAD_ROOT);

	await fs.move(tempFilePath, newFilePath);
	// console.log("XXXX", tempFilePath, newFilePath);

	if(fs.existsSync(newFilePath)) {
		fs.removeSync(tempFilePath);
		return newFilePath;
	} else {
		return false;
	}
}

async function miniio_storage(tempFilePath, fileName, bucket) {
	if(CONFIG.storage.driver!="docqdrive") return false;
	const params = CONFIG.storage.params;

	
}

async function docqdrive_storage(tempFilePath, fileName, bucket) {
	if(CONFIG.storage.driver!="docqdrive") return false;
	const params = CONFIG.storage.params;

	
}

async function s3_storage(tempFilePath, fileName, bucket) {
	if(CONFIG.storage.driver!="s3") return false;
	const params = CONFIG.storage.params;


}

async function azureobjects_storage(tempFilePath, fileName, bucket) {
	if(CONFIG.storage.driver!="azureobjects") return false;
	const params = CONFIG.storage.params;


}



/* ---------------- FILE NAME SANITIZING ---------------- */

const DEFAULT_BLOCKED_EXTENSIONS = [
	"php", "php3", "php4", "php5", "php7", "phtml", "phar", "asp", "aspx", "jsp", "jspx", "cgi", "pl",
	"py", "rb", "sh", "bash", "bat", "cmd", "com", "exe", "dll", "msi", "scr", "ps1", "vbs", "jar",
	"html", "htm", "xhtml"
];

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

function stripAccents(value) {
	return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

// One folder name: no separators, no leading/trailing dots, allowlisted characters only. Returns "" if nothing is left.
function sanitizePathSegment(segment) {
	return stripAccents(segment ?? "")
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^[._-]+|[._-]+$/g, "")
		.slice(0, 100);
}

// Safe file name: basename only, allowlisted characters, dots in the stem removed (blocks shell.php.jpg),
// stem capped at 100 chars, extension kept and lowercased.
function sanitizeFileName(filename) {
	const base = stripAccents(
		path.win32.basename(path.posix.basename(String(filename ?? "")))
	);

	const dot = base.lastIndexOf(".");
	const rawStem = dot > 0 ? base.slice(0, dot) : base;
	const rawExt = dot > 0 ? base.slice(dot + 1) : "";

	let stem = rawStem
		.replace(/[^a-zA-Z0-9._-]/g, "_") // Allow letters, numbers, ., _, -
		.replace(/_+/g, "_")             // Collapse consecutive underscores
		.replace(/^[_-]+/, "")           // Remove leading underscores and hyphens
		.slice(0, 100)
		.replace(/[_-]+$/, "");          // Remove trailing underscores and hyphens

	if (!stem) stem = "unnamed_file";
	else if (WINDOWS_RESERVED.test(stem)) stem = "_" + stem;

	const ext = rawExt
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 10)
		.toLowerCase();

	return ext ? `${stem}.${ext}` : stem;
}


function isBlockedExtension(filename) {
	const blocked = Array.isArray(CONFIG?.storage?.blocked_extensions) ? CONFIG.storage.blocked_extensions : DEFAULT_BLOCKED_EXTENSIONS;
	const ext = path.extname(String(filename)).slice(1).toLowerCase();
	return !!ext && blocked.map(e => String(e).toLowerCase()).includes(ext);
}

async function streamToBuffer(stream) {
    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

async function streamToString(stream) {
    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
}