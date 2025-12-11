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
			},
			// could add scopes too if you want additional control
			async handler(ctx) {
				var fileURI = null;
				if(ctx.params.id) {
					fileURI = null;
					//return "Not Supported Yet";
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
					throw new LogiksError("File Not Defined or Supported", 401, "FILE_NOT_DEFINED");
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

				// return {
				// 	originalName: file.originalname,
				// 	storedName: file.filename,
				// 	size: file.size,
				// 	mimetype: file.mimetype,
				// 	storedPath: file.path.replace(BASE_UPLOAD_ROOT, "")
				// };
				return {
					"status": "success",
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

				return {
					"status": "success",
					"files": files.map(file => ({
						"name": file.originalname,
						"mime": file.mimetype,
						"size": file.size,
						"path": file.path.replace(BASE_UPLOAD_ROOT, "")
					}))
				};
			}
		}
    }
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