/*
 * Fabric - Ingrained Proxy Controller
 * Nginx-style proxy where the upstream target is resolved dynamically per
 * request (DB lookup, config service, service registry, etc.) instead of
 * a static host baked into config. Uses axios with streaming request/response
 * bodies in both directions, and exposes resolution + forwarding as Moleculer
 * actions so other services can call them directly too, not just via HTTP.
 *
 * Install:
 *   npm i moleculer moleculer-web axios
 *
 * Run:
 *   npx moleculer-runner dynamic-proxy.service.js
 *
 * Example:
 *   GET /fabric/legacy/orders/42
 *     -> section "legacy" resolves (via resolveTarget action) to a base URL
 *     -> forwarded to  <base>/orders/42
 *   GET /fabric/digilogiks/content/generate
 * 
 * sys_fabric : Proxy Apps that needs to be proxied to other servers
 * 
 * eg: erp, redmine, etc
 * */

module.exports = {

    initialize : function() {
        console.log("\x1b[36m%s\x1b[0m","Fabric - Ingrained Proxy Controller Initialized");
        // return true;
    },

    /**
     * Pulls the first path segment after /fabric/ as the "section" key,
     * resolves it to a target base URL, and streams the request through.
     *   /api/fabric/legacy/orders/42  ->  section="legacy", rest="/orders/42"
     */
    async forwardRequest(req, res) {
        // console.log(">>>>>FABRIC", req.method, req.url, req.body, req.$ctx.meta);

        // const afterProxy = req.url.replace(/^\/fabric\//, "");
        const afterProxy = req.url.replace(/^\/+/, "");
        const [section, ...restParts] = afterProxy.split("/");
        const restPath = "/" + restParts.join("/");

        let target;
        let serverInfo;
        try {
            serverInfo = await resolveTarget(section, req.$ctx);
            if(!serverInfo) throw Error("Server Info Not Defined");

            target = serverInfo['server_url'];
        } catch (err) {
            res.writeHead(502, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
        }

        if (!target) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "No proxy target for section", section }));
        }

        const targetUrl = target.replace(/\/$/, "") + restPath;

        try {
            const upstream = await axios({
                method: req.method,
                url: targetUrl,
                headers: _.extend({}, this.stripHopByHopHeaders(req.headers), serverInfo.headers),
                data: ["GET", "HEAD"].includes(req.method) ? undefined : req, // stream body through
                responseType: "stream",
                validateStatus: () => true, // pass upstream status through as-is, don't throw
                maxRedirects: 0,
                timeout: 30000
            });

            const contentType = upstream.headers["content-type"] || "";
            const proxyBase = "/fabric/" + section;

            // Redirects (3xx from a logout, login-required bounce, etc.) carry
            // their destination in the Location header, not the body — rewrite
            // it the same way so the browser is sent back through
            // /fabric/<section>/... instead of the upstream's raw host/path.
            const responseHeaders = { ...upstream.headers };
            if (responseHeaders.location) {
                responseHeaders.location = rewriteLocationHeader(responseHeaders.location, target, proxyBase);
            }

            // HTML/CSS/JS/JSON responses get their root-relative resource
            // references ("/css/app.css", fetch("/api/...")) rewritten to
            // route back through this proxy's section, so the browser keeps
            // hitting /fabric/<section>/... instead of the AppServer's own
            // root paths. Anything else (images, fonts, binary, etc.) is
            // still streamed through untouched.
            const rewriter = this.getContentRewriter(contentType);
            if (!rewriter) {
                res.writeHead(upstream.status, responseHeaders);
                upstream.data.pipe(res);
                return;
            }

            const chunks = [];
            for await (const chunk of upstream.data) chunks.push(chunk);
            const body = rewriter(Buffer.concat(chunks).toString("utf8"), proxyBase);

            delete responseHeaders["content-length"];
            delete responseHeaders["content-encoding"];
            delete responseHeaders["transfer-encoding"];
            responseHeaders["content-length"] = Buffer.byteLength(body);

            res.writeHead(upstream.status, responseHeaders);
            res.end(body);
        } catch (err) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
        }
    },

    stripHopByHopHeaders(headers) {
        const clean = { ...headers };
        ["connection", "keep-alive", "transfer-encoding", "host"].forEach((h) => delete clean[h]);
        return clean;
    },

    /** Picks the URL-rewriting function for a response's content-type, or null if it shouldn't be touched. */
    getContentRewriter(contentType) {
        if (/html/i.test(contentType)) return rewriteHtml;
        if (/css/i.test(contentType)) return rewriteCssUrls;
        if (/javascript|json/i.test(contentType)) return rewriteJsStrings;
        return null;
    }
}

// Rewrites href/src/action/poster/formaction/data-src/srcset attributes,
// inline url()s, and inline <script> blocks so root-relative paths
// ("/css/app.css") point back through the proxy ("/fabric/legacy/css/app.css").
function rewriteHtml(html, proxyBase) {
    let out = html.replace(
        /\b(href|src|action|poster|formaction|data-src)(\s*=\s*)(["'])\/(?!\/)/gi,
        (m, attr, eq, quote) => `${attr}${eq}${quote}${proxyBase}/`
    );

    out = out.replace(/\bsrcset(\s*=\s*)(["'])([^"']*)\2/gi, (m, eq, quote, val) => {
        const rewritten = val
            .split(",")
            .map((part) => part.replace(/^(\s*)\/(?!\/)/, (mm, ws) => `${ws}${proxyBase}/`))
            .join(",");
        return `srcset${eq}${quote}${rewritten}${quote}`;
    });

    out = rewriteCssUrls(out, proxyBase);

    out = out.replace(
        /(<script\b(?![^>]*\bsrc\s*=)[^>]*>)([\s\S]*?)(<\/script>)/gi,
        (m, open, body, close) => `${open}${rewriteJsStrings(body, proxyBase)}${close}`
    );

    return out;
}

// Rewrites CSS url(/path) references to url(<proxyBase>/path).
function rewriteCssUrls(css, proxyBase) {
    return css.replace(/url\(\s*(["']?)\/(?!\/)/gi, (m, quote) => `url(${quote}${proxyBase}/`);
}

// Rewrites quoted string literals that are root-relative paths (e.g.
// fetch("/api/orders"), "/css/app.css") so JS/JSON keeps calling back
// through the proxy instead of the AppServer's own root.
function rewriteJsStrings(js, proxyBase) {
    return js.replace(
        /(["'`])\/(?!\/)([^"'`\r\n]*)\1/g,
        (m, quote, rest) => `${quote}${proxyBase}/${rest}${quote}`
    );
}

// Rewrites a redirect's Location header so it routes back through the proxy:
//   "/login"                    -> "/fabric/<section>/login"
//   "http://<target>/login"     -> "/fabric/<section>/login"
// Locations pointing at a different host (e.g. an external SSO provider)
// are left untouched.
function rewriteLocationHeader(location, target, proxyBase) {
    if (!location) return location;

    if (/^https?:\/\//i.test(location)) {
        try {
            const loc = new URL(location);
            const targetOrigin = new URL(target).origin;
            if (loc.origin !== targetOrigin) return location;
            return proxyBase + loc.pathname + loc.search + loc.hash;
        } catch (err) {
            return location;
        }
    }

    if (location.startsWith("/")) {
        return proxyBase + location;
    }

    return location;
}

async function resolveTarget(section, ctx) {
    var serverInfo = await _DB.db_selectQ("appdb", "sys_fabric", "*", {
            proxyid: section.replace("/",""),
            blocked: "false"
        },{});
    if(!serverInfo || !serverInfo.results || serverInfo.results.length<=0) return false;

    const newServer = serverInfo.results[0];
    try {
        newServer.headers = JSON.parse(newServer.headers);
    } catch (error) {
        newServer.headers = {};
    }

    try {
        newServer.proxy_params = JSON.parse(newServer.proxy_params);
    } catch (error) {
        newServer.proxy_params = {};
    }

    if(newServer.authorization && newServer.authorization.length>2) {
        if(["bearer", "basic"].indexOf(newServer.authorization.toLowerCase())>=0) {
            newServer.headers["Authorization"] = `${newServer.authorization} ${newServer.authorization_key}`;
        } else {
            newServer.headers[newServer.authorization] = newServer.authorization_key;
        }
    }
    if(newServer.enable_header_token=="true") {
        try {
            const token = await AUTHTOKEN.generateToken(ctx.meta.appInfo.appid, ctx.meta.user, ctx, (newServer.encrypt_header_token=="true"));
            if(token) newServer.headers['Authorization'] = `Bearer ${token}`;
        } catch(err) {
            console.error(err);
        }
    }

    await _DB.db_updateQ("appdb", "sys_fabric", {
        last_run: new moment().format("YYYY-MM-DD HH:mm:ss")
    }, {
        id: newServer.id
    });

    return newServer;
}