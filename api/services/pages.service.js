"use strict";

const fs1 = require("fs-extra");
const ejs = require("ejs");

ejs.cache = new (require("lru-cache"))({ max: 100 });

module.exports = {
	name: "pages",

	settings: {
        __file: __filename
    },

	actions: {
		async render(ctx) {

            const fullPath = ctx.meta.url;  // /pages/users/123
            const filePathArr = [
                path.join(ROOT_PATH, "public", "pages", `${fullPath}`),
                path.join(ROOT_PATH, "public", "pages", `${fullPath}.html`),
                path.join(ROOT_PATH, "public", "pages", `${fullPath}.ejs`),
                path.join(ROOT_PATH, "public", "pages", `${fullPath}.vue`),
                
                path.join(ROOT_PATH, "public", "pages", `error.404.ejs`),
                path.join(ROOT_PATH, "public", "pages", `error.ejs`),
            ];

            const availableFile = filePathArr.filter(file=> fs.existsSync(file) && fs1.statSync(file).isFile());
            // console.log("Requested path:", ctx.params, fullPath, filePathArr, availableFile);

            if(availableFile.length<=0) {
                ctx.meta.$statusCode = 404;
                ctx.meta.$responseType = "text/html";
                return "<h1 align=center>\n\n404 - Page Not Found</h1>";
            } else {
                const filePath = availableFile[0];
                const fileName = path.basename(filePath);
                const fileNameArr = fileName.split(".");
                const ext = path.extname(filePath).toLowerCase().substr(1);
                
                // if (ext && !["ejs", "html"].includes(ext)) {
                //     res.statusCode = 404;
                //     return res.end("Not Found");
                // }

                // if(fileName.includes("error")) {
                //     if(fileNameArr.length>2) {
                //         res.statusCode = fileNameArr[1];
                //     } else {
                //         res.statusCode = 404;
                //     }
                // }

                // return {
                //     status: "ok",
                //     timestamp: Date.now(),
                //     filePath: fileName,
                //     ext: ext,
                //     is_error: fileName.includes("error."),
                //     error_code: fileNameArr[1]
                // };
                return renderPage(ext, filePath, ctx, {
                    // ...ctx.meta,
                    url: fullPath,
                });
            }
        }
	}
}

async function renderPage(ext, filePath, ctx, dataParams) {
    // const res = ctx.meta.$res;
    // console.log(dataParams);
    switch(ext) {
        case "ejs":
            // EJS Renderer
            const html = await ejs.renderFile(filePath, dataParams,
                {
                    cache: true,
                    filename: filePath
                });
            ctx.meta.$responseType = "text/html";
            return html;
            break;

        case "vue":
            // Vue SFC compile example (basic)
            const content = fs.readFileSync(filePath, "utf8");
            ctx.meta.$responseType = "application/javascript";
            return content;
            break;

        default:
            const pageContent = fs.readFileSync(filePath, "utf8");
            ctx.meta.$responseType = "text/html";
            return pageContent;
            //return ctx.call("api.assets", { file: fileName });
    }
}