"use strict";

const multer = require("multer");
const fs = require("fs-extra");
const mime = require("mime-types");

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
		cb(null, `${unique}${ext}`);
	}
});

/* Security controls */
const upload = multer({
	storage,
	limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
	fileFilter(req, file, cb) {
		cb(null, true); // allow all
	}
});

module.exports = {
    name: "files",

    actions: {
        files: {
			rest: {
				method: "GET",
				fullPath: "/api/files"
			},
			params: {
				folder: { type: "string", optional: true }
			},

			async handler(ctx) {
				const folder = ctx.params.folder || "default";
				const root = path.join(BASE_UPLOAD_ROOT, folder);

				if (!(await fs.exists(root))) return [];

				const walk = async dir => {
					let results = [];
					const files = await fs.readdir(dir);

					for (const file of files) {
						const full = path.join(dir, file);
						const stat = await fs.stat(full);

						if (stat.isDirectory()) {
							results = results.concat(await walk(full));
						} else {
							results.push({
								id: Buffer.from(full).toString("base64"),
								name: file,
								size: stat.size,
								type: mime.lookup(full),
								path: full.replace(BASE_UPLOAD_ROOT, "")
							});
						}
					}
					return results;
				};

				return walk(root);
			}
		},

		filesPreview: {
			rest: {
				method: "GET",
				filePath: "/api/files/preview/:id"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				const filePath = Buffer.from(ctx.params.id, "base64").toString();

				if (!(await fs.exists(filePath))) {
					throw new Error("File not found");
				}

				if(ctx.params.download && ctx.params.download===true) {
					ctx.meta.$responseHeaders = {
						"Content-Disposition": `attachment; filename="${path.basename(filePath)}"`
					};
				}

				ctx.meta.$responseType = mime.lookup(filePath) || "application/octet-stream";

				return fs.createReadStream(filePath);
			}
		},

		upload: {
			rest: {
				method: "POST",
				fullPath: "/api/files/upload"
			},
			// middleware: [upload.array("file")],
			middleware: [
				(req, res, next) => {
        upload.single("file")(req, res, err => {

            if (err) {
                console.error("Multer error:", err);
                return next(err);
            }

            console.log(">>> MULTER OUTPUT req.file =", req.file);

            // REQUIRED: Attach multer file to Moleculer context
            if (req.file) {
                req.$ctx.meta.file = req.file;
            }

            next();
        });
    }
			],
			// params: {
				// encoded: "boolean",
				// bucket: "string",
				// meta: "object"
			// },
			async handler(ctx) {
				// const files = ctx.meta.$multipart || ctx.meta.files;

				// if (!files || files.length === 0) {
				// 	throw new Error("No file received. Use form field name 'file'");
				// }

				// return files.map(f => ({
				// 		originalName: f.originalname,
				// 		storedName: f.filename,
				// 		size: f.size,
				// 		mimetype: f.mimetype,
				// 		storedPath: f.path.replace(BASE_UPLOAD_ROOT, "")
				// 	}));

				console.log("req.file:", req.file);
console.log("ctx exists:", req.$ctx != null);

				console.log("meta:", ctx.meta);
				console.log("multipart:", ctx.meta.$multipart);
				console.log("files:", ctx.meta.files);
				console.log("upload:", upload);

				const file = ctx.meta.$multipart || ctx.meta.file;

				if (!file) throw new Error("No file received");

				return {
					originalName: file.originalname,
					storedName: file.filename,
					size: file.size,
					mimetype: file.mimetype,
					storedPath: file.path.replace(BASE_UPLOAD_ROOT, "")
				};
			}
		},

		uploadBulk: {
			rest: {
				method: "POST",
				fullPath: "/api/files/uploadbulk"
			},
			middleware: [upload.array("files")],
			// params: {
				// encoded: "boolean",
				// bucket: "string",
				// meta: "object"
			// },
			async handler(ctx) {
				console.log("XXXXXX", ctx.meta.$multipart);
				const files = ctx.meta.$multipart || [];

				return files.map(file => ({
					originalName: file.originalname,
					storedName: file.filename,
					size: file.size,
					mimetype: file.mimetype,
					storedPath: file.path.replace(BASE_UPLOAD_ROOT, "")
				}));
			}
		}
    }
};
