"use strict";

const mime = require("mime-types");
const fsp = fs.promises;

module.exports = {
    name: "files",

	actions: {
        files: {
			rest: {
				method: "GET",
				fullPath: "/api/files"
			},
			// meta: {
			// 	roles: ["admin"],
			// 	scopes: ["files:list"]
			// },
			params: {
				folder: { type: "string", optional: true },
				searchTerm: { type: "string", optional: true }
			},
			async handler(ctx) {
				var whereLogic = {
					"guid": ctx.meta.user.guid,
					"blocked": "false"
				};
				if(ctx.params.folder) {
					whereLogic['folder'] = [ctx.params.folder, "LIKE"];
				}
				if(ctx.params.searchTerm) {
					whereLogic['filename'] = [`%${ctx.params.searchTerm}%`, "LIKE"];
				}

				// limit is a number in SQL text, so it is parsed and capped here rather than passed through
				const limit = Math.min(Math.max(parseInt(ctx.params.limit) || 10, 1), 500);
				
				const sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "*", whereLogic, {}, ` ORDER BY created_on DESC LIMIT ${limit}`);
				if(!sqlResult || !sqlResult.results || sqlResult.results.length==0) return [];

				return sqlResult;
			}
		},

		fileTree: {
			rest: {
				method: "GET",
				fullPath: "/api/fileTree"
			},
			// meta: {
			// 	roles: ["admin"],
			// 	scopes: ["files:list"]
			// },
			params: {
				folder: { type: "string", optional: true }
			},
			async handler(ctx) {
				// Built from the tenant's own file records, never from the disk, so one tenant cannot list another's files
				const folder = String(ctx.params.folder || "default").split(/[\\/]+/).map(UPLOADS.sanitizePathSegment).filter(Boolean).join("/") || "default";

				const sqlResult = await _DB.db_selectQ("appdb", "files_tbl", "id, filename, path_uri, file_size, file_mime", {
					"guid": ctx.meta.user.guid,
					"blocked": "false",
					"path_uri": [`/${folder}/%`, "LIKE"]
				}, {}, " ORDER BY id DESC LIMIT 1000");
				if(!sqlResult || !sqlResult.results) return [];

				return sqlResult.results.map(row => ({
					id: row.id,
					name: row.filename,
					size: row.file_size,
					type: row.file_mime,
					hashid: Buffer.from(String(row.path_uri)).toString("base64"),
					path: row.path_uri
				}));
			}
		},

		filesPreview: {
			rest: {
				method: "GET",
				// fullPath: "/api/files/preview/:fileid?"///:id?
				fullPath: "/api/files/preview{/:fileid}"
			},
			params: {
				// uri: "string"
				// fileid: "string"
			},
			async handler(ctx) {
				const guid = ctx.meta.user.guid;
				let fileId = ctx.params.fileid;

				// A path is only a way to find the tenant's own file record; it is never read from disk directly
				if(!fileId && ctx.params.uri) {
					const rel = "/" + String(ctx.params.uri).replace(/^[\\/]+/, "").replace(/\.enc$/, "");
					const row = await _DB.db_findOne("appdb", "files_tbl", "id", { guid: guid, path_uri: rel, blocked: "false" }, 'id DESC', true);
					if(!row) throw new LogiksError("File Not Found", 404, "FILE_NOT_FOUND");
					fileId = row.id;
				}

				if(!fileId) {
					throw new LogiksError("File Not Defined or Supported", 400, "FILE_NOT_DEFINED");
				}

				const fileResponse = await FILES.getFileById(guid, fileId, "stream");
				if(!fileResponse || !fileResponse.filename || !fileResponse.stream) throw new LogiksError("File Not Found", 404, "FILE_NOT_FOUND");

				// The stored name starts with a unique id and an underscore
				const fileName = fileResponse.filename.split("_").splice(1).join("_") || fileResponse.filename;

				const served = UPLOADS.serveHeaders(fileName, ctx.params.download === true || ctx.params.download === "true");
				ctx.meta.$responseHeaders = served.headers;
				ctx.meta.$responseType = served.contentType;

				return fileResponse.stream;
			}
		},

		upload: {
			rest: {
				method: "POST",
				fullPath: "/api/files/upload"
			},
			// params: {
				// encoded: "boolean",
				// bucket: "string",
				// meta: "object"
			// },
			async handler(ctx) {
				const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
				const TEMP_UPLOAD_ROOT = UPLOADS.tempUploadFolder();

				const file = ctx.meta.file;
				if (!file) throw new Error("No file received");

				const uploadArr = await UPLOADS.moveUploadedFile(ctx, file);

				// return {
				// 	originalName: file.originalname,
				// 	storedName: file.filename,
				// 	size: file.size,
				// 	mimetype: file.mimetype,
				// 	storedPath: file.path.replace(BASE_UPLOAD_ROOT, "")
				// };
				return {
					"status": "success",
					"fileId": uploadArr[file.path],
					"name": file.originalname,
					"mime": file.mimetype,
					"size": file.size,
					"path": file.path.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, "")
				}
			}
		},

		uploadBulk: {
			rest: {
				method: "POST",
				fullPath: "/api/files/uploadbulk"
			},
			// params: {
				// encoded: "boolean",
				// bucket: "string",
				// meta: "object"
			// },
			async handler(ctx) {
				const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
				const TEMP_UPLOAD_ROOT = UPLOADS.tempUploadFolder();
				const files = ctx.meta.files || [];

				const uploadArr = await UPLOADS.moveUploadedFile(ctx, files);

				return {
					"status": "success",
					"files": files.map(file => ({
						"fileId": uploadArr[file.path],
						"name": file.originalname,
						"mime": file.mimetype,
						"size": file.size,
						"path": file.path.replace(BASE_UPLOAD_ROOT, "").replace(TEMP_UPLOAD_ROOT, "")
					}))
				};
			}
		},

		//View Trashed Files
		trash: {
			rest: {
				method: "POST",
				fullPath: "/api/files/trash"
			},
			params: {
				filters: "object"
			},
			async handler(ctx) {
				// A "RAW" value would be run as SQL text, so no client filter may carry one
				const filters = QUERY.stripRawFilter(ctx.params.filters);

				const filterData = {
					...filters,
					"blocked": "true",
					"guid": ctx.meta.user.guid
				};

				const res = await _DB.db_selectQ("appdb", "files_tbl", "*", filterData, {});

				return res;
			}
		},

		delete: {
			rest: {
				method: "POST",
				fullPath: "/api/files/delete"
			},
			params: {
				fileId: "string",
			},
			async handler(ctx) {
				const fileId = ctx.params.fileId;
				if (!fileId) throw new Error("File ID is required");

				const fileRecord = await _DB.db_findOne("appdb", "files_tbl", "*", { id: fileId, guid: ctx.meta.user.guid }, 'id DESC', true);
				if (!fileRecord) throw new Error("File not found");

				if(fileRecord.blocked == "true") {
					const filePath = UPLOADS.getTargetPath(fileRecord.path_uri);
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
					}

					await _DB.db_deleteQ("appdb", "files_tbl", { id: fileId, guid: ctx.meta.user.guid });
				} else {
					await _DB.db_updateQ("appdb", "files_tbl", {
						"blocked": "true",
						"edited_on": _DB.db_now(),
						"edited_by": ctx.meta.user.userId
					}, { id: fileId, guid: ctx.meta.user.guid });
				}

				return { status: "success", message: "File deleted successfully." };
			}
		},

		purge: {
			rest: {
				method: "DELETE",
				fullPath: "/api/files/purge"
			},
			async handler(ctx) {
				const trashedFiles = await _DB.db_selectQ("appdb", "files_tbl", "*", { 
					blocked: "true",
					guid: ctx.meta.user.guid
			 	}, {});

				for (const fileRecord of (trashedFiles?.results || [])) {
					const filePath = UPLOADS.getTargetPath(fileRecord.path_uri);
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
					}

					await _DB.db_deleteQ("appdb", "files_tbl", { id: fileRecord.id, guid: ctx.meta.user.guid });
				}

				return { status: "success", message: "Trashed files purged successfully." };
			}
		}
	}
}

//List folders and files in given path
async function listFolder(dirPath) {
	if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return false;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  // Convert to array with name + type
  const items = entries.map(entry => ({
    name: entry.name,
    isDir: entry.isDirectory()
  }));

  // Sort: folders first, then alphabetical
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1; // directories first
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return items;
}
