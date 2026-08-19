/* Self-contained OpenAPI viewer for the Logiks API.
   No CDN, no inline code — passes the gateway CSP (script-src/connect-src 'self').
   Loads the static spec generated at build time (public/openapi/openapi.json,
   mirrored as openapi.yaml for humans/tools), lists endpoints grouped by tag,
   and lets you try them with an optional token. */
(function () {
  "use strict";
  var origin = location.origin;
  var qs = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var specInput = $("specUrl"), tokenInput = $("token"), app = $("app"), statusEl = $("status");

  // Candidate spec URLs to probe if the given one fails. The static file
  // (this folder) is tried first since it always exists, in every env;
  // the live moleculer-generated ones are dev/UAT-only fallbacks.
  var CANDIDATES = [
    "/openapi/openapi.json",
    "/api/developers.swagger/openapi.json",
    "/api/openapi.json"
  ];

  specInput.value = qs.get("spec") || localStorage.getItem("logiks-openapi-spec") || (origin + CANDIDATES[0]);
  tokenInput.value = qs.get("token") || localStorage.getItem("logiks-openapi-token") || "";

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function authHeaders() {
    var t = (tokenInput.value || "").trim(), h = {};
    if (t) {
      h["Authorization"] = /^bearer /i.test(t) ? t : ("Bearer " + t);
      h["X-API-Key"] = t.replace(/^bearer\s+/i, "");
    }
    return h;
  }

  function setStatus(msg, kind) { statusEl.textContent = msg; statusEl.className = "status " + (kind || ""); }

  async function tryUrl(url) {
    try {
      var res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) return null;
      var data = await res.json();
      if (data && data.paths) return data;
    } catch (e) { /* ignore and try next */ }
    return null;
  }

  async function loadSpec() {
    localStorage.setItem("logiks-openapi-spec", specInput.value.trim());
    localStorage.setItem("logiks-openapi-token", (tokenInput.value || "").trim());
    app.innerHTML = "";
    setStatus("Loading spec…");

    var url = specInput.value.trim();
    var spec = await tryUrl(url);
    if (!spec) {
      var tried = [url];
      for (var i = 0; i < CANDIDATES.length && !spec; i++) {
        var u = origin + CANDIDATES[i];
        if (tried.indexOf(u) < 0) { tried.push(u); spec = await tryUrl(u); if (spec) specInput.value = u; }
      }
    }
    if (!spec) {
      setStatus("Could not load the OpenAPI spec. Check the URL and your token.", "err");
      return;
    }
    render(spec);
  }

  function render(spec) {
    var info = spec.info || {};
    setStatus((info.title || "API") + " · v" + (info.version || "?") + " · " + Object.keys(spec.paths).length + " paths", "ok");
    var base = (spec.servers && spec.servers[0] && spec.servers[0].url) || origin;

    var tagDesc = {};
    (spec.tags || []).forEach(function (t) { tagDesc[t.name] = t.description || ""; });

    var groups = {};
    Object.keys(spec.paths).sort().forEach(function (p) {
      var methods = spec.paths[p];
      Object.keys(methods).forEach(function (m) {
        var op = methods[m] || {};
        var tag = (op.tags && op.tags[0]) || "default";
        (groups[tag] = groups[tag] || []).push({ path: p, method: m.toUpperCase(), op: op });
      });
    });

    Object.keys(groups).sort().forEach(function (tag) {
      var sec = el("section", "group");
      sec.appendChild(el("h2", "group-title", tag + " (" + groups[tag].length + ")"));
      if (tagDesc[tag]) sec.appendChild(el("p", "group-desc", tagDesc[tag]));
      groups[tag].forEach(function (o) { sec.appendChild(opRow(o, base)); });
      app.appendChild(sec);
    });
  }

  function opRow(o, base) {
    var row = el("div", "op");
    var head = el("button", "op-head");
    head.appendChild(el("span", "m m-" + o.method.toLowerCase(), o.method));
    head.appendChild(el("span", "op-path", o.path));
    if (o.op.summary) head.appendChild(el("span", "op-sum", o.op.summary));
    if (o.op.security && o.op.security.length) head.appendChild(el("span", "op-lock", "🔒"));

    var panel = el("div", "op-panel hidden");
    head.addEventListener("click", function () { panel.classList.toggle("hidden"); });
    if (o.op.description && o.op.description !== o.op.summary) {
      panel.appendChild(el("p", "op-desc", o.op.description));
    }
    buildTry(panel, o, base);

    row.appendChild(head);
    row.appendChild(panel);
    return row;
  }

  function buildTry(panel, o, base) {
    var params = o.op.parameters || [];
    var inputs = {};

    if (params.length) {
      var pl = el("div", "params");
      params.forEach(function (p) {
        var wrap = el("label", "param");
        wrap.appendChild(el("span", "param-name", p.name + (p.required ? " *" : "") + " · " + (p.in || "query")));
        var inp = el("input");
        inp.placeholder = (p.schema && p.schema.default != null) ? String(p.schema.default) : p.name;
        inputs[p.name] = { in: p.in || "query", el: inp };
        wrap.appendChild(inp);
        pl.appendChild(wrap);
      });
      panel.appendChild(pl);
    }

    var bodyTa = null;
    if (o.op.requestBody) {
      bodyTa = el("textarea", "body");
      bodyTa.placeholder = "{ JSON request body }";
      try {
        var json = o.op.requestBody.content && o.op.requestBody.content["application/json"];
        var schema = json && json.schema;
        if (schema && schema.properties) {
          var sample = {};
          Object.keys(schema.properties).forEach(function (k) {
            var def = schema.properties[k];
            sample[k] = def && def.default != null ? def.default : "";
          });
          bodyTa.value = JSON.stringify(sample, null, 2);
        } else if (o.op.requestBody.content && o.op.requestBody.content["multipart/form-data"]) {
          bodyTa = null; // file upload — not supported by this lightweight tester
        }
      } catch (e) { /* leave empty */ }
      if (bodyTa) panel.appendChild(bodyTa);
      else if (o.op.requestBody.content && o.op.requestBody.content["multipart/form-data"]) {
        panel.appendChild(el("p", "op-desc", "This endpoint expects multipart/form-data (file upload) — use curl/Postman to try it."));
      }
    }

    var send = el("button", "send", "Send " + o.method);
    var out = el("pre", "out hidden");

    send.addEventListener("click", async function () {
      var url = o.path, query = [];
      Object.keys(inputs).forEach(function (name) {
        var pi = inputs[name], v = pi.el.value;
        if (!v) return;
        if (pi.in === "path") url = url.replace("{" + name + "}", encodeURIComponent(v));
        else query.push(encodeURIComponent(name) + "=" + encodeURIComponent(v));
      });
      var root = /^https?:/.test(base) ? base.replace(/\/$/, "") : origin;
      var full = root + url + (query.length ? ("?" + query.join("&")) : "");

      var opt = { method: o.method, headers: authHeaders() };
      if (bodyTa && bodyTa.value.trim()) {
        opt.headers["Content-Type"] = "application/json";
        opt.body = bodyTa.value;
      }

      out.classList.remove("hidden");
      out.textContent = "Sending " + o.method + " " + full + " …";
      try {
        var res = await fetch(full, opt);
        var text = await res.text(), pretty;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { pretty = text; }
        out.textContent = res.status + " " + res.statusText + "\n\n" + pretty;
      } catch (e) {
        out.textContent = "Request failed: " + e.message + "\n(If this is a CORS or auth error, confirm the token and that the API is on this origin.)";
      }
    });

    panel.appendChild(send);
    panel.appendChild(out);
  }

  $("load").addEventListener("click", loadSpec);
  specInput.addEventListener("keydown", function (e) { if (e.key === "Enter") loadSpec(); });
  tokenInput.addEventListener("keydown", function (e) { if (e.key === "Enter") loadSpec(); });
  loadSpec();
})();
