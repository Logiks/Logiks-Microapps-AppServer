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

    registerUploadedFile: async function(req, fileArray) {
        //Log all uploaded files into files_tbl
        // files_tbl
        // `guid` varchar(155) NOT NULL,
        // `appid` varchar(50) NOT NULL,
        // `filename` varchar(155) DEFAULT NULL,
        // `folder` varchar(155) DEFAULT NULL,
        // `path_uri` varchar(255) DEFAULT NULL,
        // `file_mime` varchar(20) DEFAULT NULL,
        // `file_size` int DEFAULT '0',
        // `file_year` varchar(5) NOT NULL DEFAULT '0000',
        // `flags` varchar(155) DEFAULT NULL,
        // `metadata` longtext,
    }
}
