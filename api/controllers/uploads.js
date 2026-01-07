/*
 * File Upload Handler
 * 
 * */

const multer = require("multer");
const fs = require("fs-extra");

const BASE_UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(ROOT_PATH+"/uploads/");

/* ---------------- STORAGE ENGINE ---------------- */

const storage = multer.diskStorage({
	async destination(req, file, cb) {
		try {
			// user selected base folder
			const userFolder = req.query.folder || "default";

			const now = new Date();
			const year = now.getFullYear();
			const month = String(now.getMonth() + 1).padStart(2, "0");

			// keep original folder structure
			const relativePath = file.webkitRelativePath || file.originalname;
			const safeRelative = relativePath.replace(/\.\./g, "");

			const uploadDir = path.join(
				BASE_UPLOAD_ROOT,
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

    getTargetPath: function(folder) {
        return path.join(BASE_UPLOAD_ROOT, folder);
    },

    getUploadHandler: function() {
        return uploadHandler;
    },

	//Log all uploaded files into files_tbl
    registerUploadedFile: async function(ctx, fileArray) {
		// const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
		// console.log("registerUploadedFile", ctx, fileArray);
        
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
			for(var i=0;i<fileArray.length-1;i++) {
				const file = fileArray[i];

				const sqlResult = await _DB.db_insertQ1("appdb", "files_tbl", _.extend({
					"guid": ctx.meta.user.guid,
					"appid": ctx.meta.appInfo.appid,

					"filename": file.filename,
					"folder": ctx.params.bucket?ctx.params.bucket:"-",
					"path_uri": file.path.replace(BASE_UPLOAD_ROOT, ""),
					"file_mime": file.mimetype,
					"file_size": file.size,
					"file_year": new moment().format("Y"),
					"metadata": JSON.stringify(ctx.params.meta),
					"extracted_data": "",
					"processed": "false",
					"flags": "",
				}, MISC.generateDefaultDBRecord(ctx, false)));

				//console.log("XXXXX", sqlResult.insertId);
				
				result[file.path] = sqlResult.insertId?sqlResult.insertId:0;
			}
		} else {
			const file = fileArray;

			const sqlResult = await _DB.db_insertQ1("appdb", "files_tbl", _.extend({
                "guid": ctx.meta.user.guid,
                "appid": ctx.meta.appInfo.appid,

				"filename": file.filename,
				"folder": ctx.params.bucket?ctx.params.bucket:"-",
				"path_uri": file.path.replace(BASE_UPLOAD_ROOT, ""),
				"file_mime": file.mimetype,
				"file_size": file.size,
				"file_year": new moment().format("Y"),
				"metadata": JSON.stringify(ctx.params.meta),
				"extracted_data": "",
				"processed": "false",
				"flags": "",
            }, MISC.generateDefaultDBRecord(ctx, false)));

			//console.log("XXXXX", sqlResult.insertId);

			result[file.path] = sqlResult.insertId?sqlResult.insertId:0;
		}

		return result;
    }
}
