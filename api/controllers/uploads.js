/*
 * File Upload Handler
 * 
 * */

const multer = require("multer");
const fs = require("fs-extra");

const TEMP_UPLOAD_ROOT = process.env.UPLOAD_TEMP || path.resolve(ROOT_PATH+`/${CONFIG.storage.temp_path || "temp"}/`);
const BASE_UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(ROOT_PATH+`/${CONFIG.storage.base_path || "uploads"}/`);

fs.ensureDir(TEMP_UPLOAD_ROOT);

/* ---------------- STORAGE ENGINE ---------------- */

const storage = multer.diskStorage({
	async destination(req, file, cb) {
		try {
			// user selected base folder
			const userFolder = req.query.folder || "default";

			const now = moment().format("Y-M-D HH:mm:ss");
			const year = moment().format("Y");
			const month = moment().format("M").padStart(2, "0");

			// keep original folder structure
			const relativePath = file.webkitRelativePath || file.originalname;
			const safeRelative = relativePath.replace(/\.\./g, "");

			const uploadDir = path.join(
				TEMP_UPLOAD_ROOT,//BASE_UPLOAD_ROOT
				userFolder,
				year.toString(),
				month,
				path.dirname(safeRelative)
			);

			await fs.ensureDir(uploadDir);
			cb(null, uploadDir);
		} catch (err) {
			cb(err);
		}
	},

	filename(req, file, cb) {
		const unique = UNIQUEID.generate(10);
		const ext = path.extname(file.originalname);
		//cb(null, `${unique}${ext}`);
        cb(null, `${unique}_${file.originalname}`);
	}
});

/* Security controls */
const uploadHandler = multer({
	storage,
	limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
	fileFilter(req, file, cb) {
		cb(null, true); // allow all
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

    getTargetPath: function(filePath) {
        return path.join(BASE_UPLOAD_ROOT, filePath);
    },

    getUploadHandler: function() {
        return uploadHandler;
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

		const bucket = ctx.params.bucket?ctx.params.bucket:"default";

        // CONFIG.log_sql = true;
		var result = {};

		if(Array.isArray(fileArray)) {
			for(var i=0;i<fileArray.length-1;i++) {
				const file = fileArray[i];

				const fileURI = await move_to_store(file.path, file.filename, bucket);

				const sqlResult = await _DB.db_insertQ1("appdb", "files_tbl", _.extend({
					"guid": ctx.meta.user.guid,
					"appid": ctx.meta.appInfo.appid,

					"filename": file.filename,
					"folder": bucket,
					"path_uri": fileURI.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, ""),
					"file_mime": file.mimetype,
					"file_size": file.size,
					"file_year": new moment().format("Y"),
					"metadata": JSON.stringify(ctx.params.meta),
					"driver": CONFIG.storage.driver,
					"processed": "false",
					"flags": "",
				}, MISC.generateDefaultDBRecord(ctx, false)));

				//console.log("XXXXX", sqlResult.insertId);
				
				result[file.path] = sqlResult.insertId?sqlResult.insertId:0;
			}
		} else {
			const file = fileArray;

			const fileURI = await move_to_store(file.path, file.filename, bucket);

			const sqlResult = await _DB.db_insertQ1("appdb", "files_tbl", _.extend({
                "guid": ctx.meta.user.guid,
                "appid": ctx.meta.appInfo.appid,

				"filename": file.filename,
				"folder": bucket,
				"path_uri": fileURI.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, ""),
				"file_mime": file.mimetype,
				"file_size": file.size,
				"file_year": new moment().format("Y"),
				"metadata": JSON.stringify(ctx.params.meta),
				"driver": CONFIG.storage.driver,
				"processed": "false",
				"flags": "",
            }, MISC.generateDefaultDBRecord(ctx, false)));

			//console.log("XXXXX", sqlResult.insertId);

			result[file.path] = sqlResult.insertId?sqlResult.insertId:0;
		}

		return result;
    },

	resolveFileObj: async function(fileObj, responseType = "stream") {
		return get_from_store(fileObj, responseType);
	}
}

async function get_from_store(fileObj, responseType = "stream") {
	if(!fileObj.driver) fileObj.driver = CONFIG.storage.driver;
	
	switch (fileObj.driver) {
		case "local":
			const filePath = path.join(UPLOADS.baseUploadFolder(), fileObj.path_uri);
			
			if(!filePath || !fs.existsSync(filePath)) {
				return null;
			}

			if(responseType=="stream") {
				return fs.createReadStream(filePath);
			} else if(responseType=="buffer") {
				return fs.readFileSync(filePath);
			} else if(responseType=="content") {
				return await fs.readFileSync(filePath, "utf8");
			} else {
				return await fs.readFileSync(filePath, "utf8");
			}
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

async function move_to_store(tempFilePath, fileName, bucket) {
	// console.log("XXXXXXX", CONFIG.storage, tempFilePath, fileName, bucket);
	
	switch (CONFIG.storage.driver) {
		case "local":
			return local_storage(tempFilePath, fileName, bucket);
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