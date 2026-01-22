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
				folder: { type: "string", optional: true }
			},
			async handler(ctx) {
				const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
				const folder = ctx.params.folder || "";
				const targetPath = UPLOADS.getTargetPath(folder);

				const fsFiles = await listFolder(targetPath);
				const error = fsFiles?null:"Given path is not a folder or does not exist";

				var results = {
					"path": targetPath.replace(BASE_UPLOAD_ROOT, ""),
					"list": fsFiles,
				};
				if(error) results.error = error;

				return results;
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
				const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
				const folder = ctx.params.folder || "default";
				const root = UPLOADS.getTargetPath(folder);

				// If root does not exist → return empty array
				if (!fs.existsSync(root)) return [];

				const fsFiles = await walkDirectory(root, 2);

				return fsFiles;
			}
		},

		filesPreview: {
			rest: {
				method: "GET",
				fullPath: "/api/files/preview/:id?"///:id?
			},
			params: {
				// uri: "string"
				// fileid: "string"
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				var fileURI = null;
				if(ctx.params.fileid) {
					const fileResponse = FILES.getFileById(ctx.meta.user.guid, ctx.params.fileid, "stream");
					if(fileResponse && fileResponse.stream)
						return fileResponse.stream;
					else
						return "File not found";
				} else if(ctx.params.uri) {
					fileURI = UPLOADS.getTargetPath(ctx.params.uri);
				}

				if(fileURI) {
					if(fs.existsSync(fileURI)) {
						var fileName = path.basename(fileURI);
						fileName = fileName.split("_").splice(1).join("_");
						
						if(ctx.params.download && ctx.params.download===true) {
							ctx.meta.$responseHeaders = {
								"Content-Disposition": `attachment; filename="${fileName}"`
							};
						}

						ctx.meta.$responseType = mime.lookup(fileURI) || "application/octet-stream";

						return fs.createReadStream(fileURI);
					} else {
						throw new LogiksError("File Not Found", 404, "FILE_NOT_FOUND");
					}
				} else {
					throw new LogiksError("File Not Defined or Supported", 400, "FILE_NOT_DEFINED");
				}
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
				const file = ctx.meta.file;
				if (!file) throw new Error("No file received");

				const uploadArr = await UPLOADS.registerUploadedFile(ctx, file);

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
					"path": file.path.replace(BASE_UPLOAD_ROOT, "")
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
				const files = ctx.meta.files || [];

				const uploadArr = await UPLOADS.registerUploadedFile(ctx, files);

				return {
					"status": "success",
					"files": files.map(file => ({
						"fileId": uploadArr[file.path],
						"name": file.originalname,
						"mime": file.mimetype,
						"size": file.size,
						"path": file.path.replace(BASE_UPLOAD_ROOT, "")
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
				const filters = ctx.params.filters || {};

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
				method: "DELETE",
				fullPath: "/api/files/delete"
			},
			params: {
				fileId: "string",
			},
			async handler(ctx) {
				const fileId = ctx.params.fileId;
				if (!fileId) throw new Error("File ID is required");

				const fileRecord = await _DB.db_findOne("appdb", "files_tbl", "*", { id: fileId }, {});
				if (!fileRecord) throw new Error("File not found");

				if(fileRecord.blocked == "true") {
					const filePath = UPLOADS.getTargetPath(fileRecord.path);
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
					}

					await _DB.db_delete("appdb", "files_tbl", { id: fileId });
				} else {
					await _DB.db_updateQ("appdb", "files_tbl", {
						"blocked": "true",
						"edited_on": _DB.db_now(),
						"edited_by": ctx.meta.user.userid
					}, { id: fileId });
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

				for (const fileRecord of trashedFiles) {
					const filePath = UPLOADS.getTargetPath(fileRecord.path);
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath);
					}

					await _DB.db_delete("appdb", "files_tbl", { id: fileRecord.id });
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

/**
 * High-performance directory walker.
 *
 * @param {string} root - Base directory path to scan
 * @param {number} maxDepth - Maximum depth to scan
 * @returns {Promise<Array>}
 */
async function walkDirectory(root, maxDepth = 5) {
	const BASE_UPLOAD_ROOT = UPLOADS.baseUploadFolder();
    const results = [];

    // Use your stack instead of recursion (faster & safer)
    const stack = [{ dir: root, depth: 0 }];

    while (stack.length > 0) {
        const { dir, depth } = stack.pop();

        // Depth limit protection
        if (depth > maxDepth) continue;

        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (err) {
            console.error("Failed to read directory:", dir, err);
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Add folder to stack if within depth
                if (depth < maxDepth) {
                    stack.push({ dir: fullPath, depth: depth + 1 });
                }
            } else {
                // Stat the file for size (lazy: only when needed)
                let stat;
                try {
                    stat = await fsp.stat(fullPath);
                } catch {
                    continue;
                }

                results.push({
                    name: entry.name,
                    size: stat.size,
                    type: mime.lookup(fullPath),
					hashid: Buffer.from(fullPath).toString("base64"),
                    path: fullPath.replace(BASE_UPLOAD_ROOT, "")
                });
            }
        }
    }

    return results;
}