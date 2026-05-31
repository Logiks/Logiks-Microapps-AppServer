#!/usr/bin/env node
/*
 * Build a tabbed, offline-capable static HTML site from docs/ (for nginx).
 *
 *   node docs/build-docs.mjs
 *
 * Output:  public/docs/   (mirrors docs/, .md -> .html), served at BASE (default "/").
 *
 * Features
 *  - Offline fonts: Inter + JetBrains Mono are vendored (downloaded once into
 *    docs/.vendor, then copied into the build). After the first online build,
 *    rebuilds work fully offline. No CDN at page-load time.
 *  - Alpine.js is vendored the same way and drives all interactivity.
 *  - Header and footer are PARTIALS (public/docs/partials/*.html) loaded by Alpine.
 *  - Every doc is converted to HTML. "Private" docs are still built (reachable by
 *    URL) but are not linked from any menu (tabs / sidebar / prev-next). Mark a doc
 *    private by listing it in PRIVATE_PATHS or putting <!-- private --> near its top.
 *  - .md links are rewritten to .html; GitHub-style heading anchors are added.
 *
 * First build needs network (to fetch fonts + Alpine once). If it can't reach the
 * network, the site still builds and renders with system fonts; re-run online to
 * vendor the assets.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = __dirname;
const OUT_DIR = path.join(REPO_ROOT, "public", "docs");
const VENDOR_DIR = path.join(DOCS_DIR, ".vendor");      // persistent cache (survives rebuilds)
const SITE_NAME = "Logiks MicroApps";
const SITE_TAG = "Documentation";
const ALPINE_URL = "https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js";
const FONTS_CSS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Private docs are built (reachable by URL) but never linked in a menu.
// A doc is private if it lives under docs/private/, is listed below, or carries
// a <!-- private --> marker near its top.
const PRIVATE_DIR = "private";
const PRIVATE_PATHS = new Set([
  // e.g. "others/internal-notes.md"
]);

console.log("Building docs…");

// ---- marked (auto-install once) -------------------------------------------
let marked;
try {
  ({ marked } = await import("marked"));
} catch {
  console.log("• marked not found — installing locally (no-save)…");
  execSync("npm install --no-save marked", { cwd: REPO_ROOT, stdio: "inherit" });
  ({ marked } = await import("marked"));
}
marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: false });

// ---- small utils ----------------------------------------------------------
const exists = (p) => fs.existsSync(p);
const url = (relHtml) => relHtml.split(path.sep).join("/");
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function download(u, dest, headers = {}) {
  const res = await fetch(u, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf;
}

// ---- vendor Alpine + fonts (cached in docs/.vendor) -----------------------
async function vendorAlpine() {
  const dest = path.join(VENDOR_DIR, "alpine.min.js");
  if (exists(dest)) return true;
  try {
    await download(ALPINE_URL, dest);
    console.log("• vendored Alpine.js");
    return true;
  } catch (e) {
    console.warn("⚠ could not vendor Alpine.js (offline?). Interactivity will be limited:", e.message);
    return false;
  }
}

async function vendorFonts() {
  const cssCache = path.join(VENDOR_DIR, "fonts.css");
  if (exists(cssCache)) return fs.readFileSync(cssCache, "utf8");
  try {
    const css = await (await fetch(FONTS_CSS_URL, { headers: { "User-Agent": UA } })).text();
    const re = /\/\*\s*([^*]+?)\s*\*\/\s*(@font-face\s*\{[\s\S]*?\})/g;
    const faces = [];
    const byUrl = new Map();                              // dedupe: variable fonts share one file across weights
    let m;
    while ((m = re.exec(css))) {
      if (m[1].trim() !== "latin") continue;            // keep latin subset only
      const block = m[2];
      const fam = (block.match(/font-family:\s*'([^']+)'/) || [])[1];
      const wght = (block.match(/font-weight:\s*(\d+)/) || [])[1];
      const woff2 = (block.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
      if (!fam || !wght || !woff2) continue;
      let file = byUrl.get(woff2);
      if (!file) {
        file = `${fam.toLowerCase().replace(/\s+/g, "")}-${wght}.woff2`;
        await download(woff2, path.join(VENDOR_DIR, "fonts", file));
        byUrl.set(woff2, file);
      }
      faces.push(
        `@font-face{font-family:'${fam}';font-style:normal;font-weight:${wght};font-display:swap;` +
        `src:url(vendor/fonts/${file}) format('woff2');}`
      );
    }
    const out = faces.join("\n");
    fs.writeFileSync(cssCache, out);
    console.log(`• vendored ${faces.length} font file(s)`);
    return out;
  } catch (e) {
    console.warn("⚠ could not vendor fonts (offline?). Falling back to system fonts:", e.message);
    return "";
  }
}

// ---- markdown processing --------------------------------------------------
function slugify(text) {
  return text
    .replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, "")
    .trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
function processHeadings(html) {
  const seen = new Map();
  const toc = [];
  const out = html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (m, lvl, attrs, inner) => {
    if (/\sid=/.test(attrs)) return m;
    let slug = slugify(inner) || "section";
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    if (lvl === "2" || lvl === "3") toc.push({ level: Number(lvl), id: slug, text: stripTags(inner) });
    return `<h${lvl}${attrs} id="${slug}">${inner}</h${lvl}>`;
  });
  return { html: out, toc };
}
function rewriteLinks(html) {
  return html.replace(
    /href="(?!https?:|\/\/|#|mailto:)([^"#]+)\.md(#[^"]*)?"/g,
    (m, p, anchor) => `href="${p}.html${anchor || ""}"`
  );
}
function firstHeading(md, fallback) {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].replace(/[`*]/g, "").trim() : fallback;
}
function isPrivateMd(md) {
  return /<!--\s*(private|nav:\s*hidden)\s*-->/i.test(md.slice(0, 400));
}

// ---- collect docs ---------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const allFiles = walk(DOCS_DIR).filter((f) => f !== path.join(DOCS_DIR, "build-docs.mjs"));
const mdFiles = allFiles.filter((f) => f.endsWith(".md"));
const assetFiles = allFiles.filter((f) => !f.endsWith(".md"));

const pages = mdFiles.map((file) => {
  const rel = path.relative(DOCS_DIR, file);
  const relHtml = rel.replace(/\.md$/, ".html");
  const md = fs.readFileSync(file, "utf8");
  return {
    file, rel, relHtml,
    group:
      rel.startsWith("training" + path.sep) ? "Training" :
      rel.startsWith("others" + path.sep) ? "Guides" : "Chapters",
    title: firstHeading(md, path.basename(rel, ".md")),
    private: rel.split(path.sep)[0] === PRIVATE_DIR || PRIVATE_PATHS.has(url(rel)) || isPrivateMd(md),
    md,
  };
});

// ---- menu data (private excluded) -----------------------------------------
const GROUP_ORDER = ["Chapters", "Guides", "Training"];
function navSort(a, b) {
  const pri = (p) => (/README/i.test(p.rel) ? 0 : /quickstart/i.test(p.rel) ? 1 : 2);
  return pri(a) - pri(b) || a.rel.localeCompare(b.rel, undefined, { numeric: true });
}
const grouped = GROUP_ORDER
  .map((g) => ({ group: g, items: pages.filter((p) => p.group === g && !p.private).sort(navSort) }))
  .filter((g) => g.items.length);

const firstOf = (g) => grouped.find((x) => x.group === g)?.items[0];

// ---- partials (header / footer) -------------------------------------------
// Partials are shared across pages of different depths, so their links are
// resolved at runtime against window.BASE (the current page's relative prefix).
function headerPartial() {
  const tabs = grouped.map(({ group }) => {
    const first = firstOf(group);
    return `<a class="tab" :class="{active: $store.ui.group==='${group}'}" :href="window.BASE+'${url(first.relHtml)}'">${group}</a>`;
  }).join("");
  return `<label class="burger" @click="$store.ui.toggleNav()" aria-label="Menu"><span></span><span></span><span></span></label>
<a class="brand" :href="window.BASE+'index.html'"><span class="logo">◆</span> ${SITE_NAME} <em>${SITE_TAG}</em></a>
<nav class="tabs">${tabs}</nav>
<button class="theme-btn" @click="$store.ui.toggle()" x-text="$store.ui.theme==='dark' ? '☀' : '☾'" aria-label="Toggle theme"></button>`;
}
function footerPartial() {
  return `<span>${SITE_NAME} ${SITE_TAG}</span>
<span class="sep">·</span>
<a :href="window.BASE+'index.html'">Index</a>
<span class="sep">·</span>
<span>Built from <code>docs/</code></span>`;
}

// ---- per-page fragments ---------------------------------------------------
function sidebarHtml(current, prefix) {
  const items = grouped.find((g) => g.group === current.group)?.items || [];
  const links = items.map((p) => {
    const active = p.relHtml === current.relHtml ? ' class="active"' : "";
    return `<li x-show="!q || $el.textContent.toLowerCase().includes(q.toLowerCase())"><a${active} href="${prefix}${url(p.relHtml)}">${escapeHtml(p.title)}</a></li>`;
  }).join("");
  return `<input type="search" class="filter" x-model="q" placeholder="Filter ${current.group.toLowerCase()}…" autocomplete="off">
<ul class="nav-list">${links}</ul>`;
}
function tocHtml(toc) {
  if (toc.length < 2) return "";
  const items = toc.map((t) => `<li class="lvl${t.level}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join("");
  return `<div class="toc-title">On this page</div><ul>${items}</ul>`;
}
function prevNextHtml(current, prefix) {
  const items = grouped.find((g) => g.group === current.group)?.items || [];
  const i = items.findIndex((p) => p.relHtml === current.relHtml);
  if (i < 0) return "";                                  // private pages get no prev/next
  const prev = items[i - 1], next = items[i + 1];
  if (!prev && !next) return "";
  const cell = (p, dir) => p
    ? `<a class="pn ${dir}" href="${prefix}${url(p.relHtml)}"><span>${dir === "prev" ? "← Previous" : "Next →"}</span><strong>${escapeHtml(p.title)}</strong></a>`
    : `<span class="pn empty"></span>`;
  return `<nav class="prevnext">${cell(prev, "prev")}${cell(next, "next")}</nav>`;
}

// ---- page template --------------------------------------------------------
function pageHtml(page, bodyHtml, toc) {
  const depth = page.rel.split(path.sep).length - 1;     // 0 at docs root, 1 in training/ others/ private/
  const prefix = "../".repeat(depth);                    // relative → deployable at root, subfolder, or subdomain
  const hasToc = toc.length >= 2;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} · ${SITE_NAME}</title>
<link rel="stylesheet" href="${prefix}styles.css">
<script>window.BASE=${JSON.stringify(prefix)};</script>
<script>(function(){var t=localStorage.getItem('docs-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);})();</script>
</head>
<body data-group="${page.group}"${hasToc ? "" : ' class="no-toc"'}>
<header id="appbar" class="appbar" x-data x-init="includePartial($el, window.BASE+'partials/header.html')"></header>
<div class="layout">
  <aside class="sidebar" x-data="{q:''}" :class="{open: $store.ui.nav}">${sidebarHtml(page, prefix)}</aside>
  <main class="content">
    <article class="md">${bodyHtml}</article>
    ${prevNextHtml(page, prefix)}
  </main>
  <aside class="toc" x-data="tocSpy">${tocHtml(toc)}</aside>
</div>
<div class="scrim" x-data :class="{show: $store.ui.nav}" @click="$store.ui.nav=false"></div>
<footer id="footer" class="footer" x-data x-init="includePartial($el, window.BASE+'partials/footer.html')"></footer>
<script defer src="${prefix}app.js"></script>
<script defer src="${prefix}vendor/alpine.min.js"></script>
</body>
</html>`;
}

// ---- app.js (our code; registers Alpine stores/components + partial loader) -
const APPJS = `
window.includePartial = async function (el, u) {
  try {
    const res = await fetch(u);
    el.innerHTML = await res.text();
    if (window.Alpine && Alpine.initTree) Alpine.initTree(el);
  } catch (e) { /* offline / missing partial */ }
};
document.addEventListener('alpine:init', function () {
  Alpine.store('ui', {
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    group: document.body.dataset.group || '',
    nav: false,
    toggle() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('docs-theme', this.theme);
      document.documentElement.setAttribute('data-theme', this.theme);
    },
    toggleNav() { this.nav = !this.nav; }
  });
  Alpine.data('tocSpy', function () {
    return {
      init() {
        var links = Array.prototype.slice.call(this.$el.querySelectorAll('a'));
        if (!links.length) return;
        var map = {};
        links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
        var heads = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
        var obs = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              links.forEach(function (l) { l.classList.remove('active'); });
              if (map[e.target.id]) map[e.target.id].classList.add('active');
            }
          });
        }, { rootMargin: '-70px 0px -70% 0px', threshold: 0 });
        heads.forEach(function (h) { obs.observe(h); });
      }
    };
  });
});
`;

// ---- CSS ------------------------------------------------------------------
function buildCss(fontFace) {
  return `${fontFace ? fontFace + "\n" : ""}:root{
  --bg:#fff;--surface:#f8fafc;--surface-2:#f1f5f9;--text:#0f172a;--muted:#64748b;
  --border:#e2e8f0;--accent:#6366f1;--accent-weak:#eef2ff;--ring:rgba(99,102,241,.35);
  --code-bg:#0d1117;--code-fg:#e6edf3;--appbar:rgba(255,255,255,.82);--shadow:0 1px 3px rgba(15,23,42,.08),0 8px 24px rgba(15,23,42,.06);
}
[data-theme=dark]{
  --bg:#0b0f17;--surface:#0f1521;--surface-2:#131b2a;--text:#e5e7eb;--muted:#94a3b8;
  --border:#1e293b;--accent:#818cf8;--accent-weak:#1e1b4b;--ring:rgba(129,140,248,.35);
  --code-bg:#0a0e16;--code-fg:#e6edf3;--appbar:rgba(11,15,23,.82);--shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.4);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
[x-cloak]{display:none!important}

.appbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:18px;height:60px;padding:0 22px;
  background:var(--appbar);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--text);white-space:nowrap}
.brand:hover{text-decoration:none}.brand .logo{color:var(--accent)}
.brand em{font-style:normal;font-weight:500;color:var(--muted);font-size:13px;padding:2px 8px;border:1px solid var(--border);border-radius:999px}
.tabs{display:flex;gap:4px;margin-left:8px;overflow:auto}
.tab{padding:8px 14px;border-radius:8px;color:var(--muted);font-weight:600;font-size:14px;white-space:nowrap}
.tab:hover{color:var(--text);background:var(--surface-2);text-decoration:none}
.tab.active{color:var(--accent);background:var(--accent-weak)}
.theme-btn{margin-left:auto;background:var(--surface-2);border:1px solid var(--border);color:var(--text);
  width:38px;height:38px;border-radius:10px;cursor:pointer;font-size:16px;line-height:1}
.theme-btn:hover{border-color:var(--accent)}
.burger{display:none;flex-direction:column;gap:4px;cursor:pointer;padding:6px}
.burger span{width:20px;height:2px;background:var(--text);border-radius:2px}

.layout{display:grid;grid-template-columns:280px minmax(0,1fr) 240px;max-width:1500px;margin:0 auto}
body.no-toc .layout{grid-template-columns:280px minmax(0,1fr)}

.sidebar{position:sticky;top:60px;align-self:start;height:calc(100vh - 60px);overflow:auto;padding:18px 14px;border-right:1px solid var(--border)}
.filter{width:100%;padding:9px 12px;margin-bottom:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;outline:none}
.filter:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}
.nav-list{list-style:none;margin:0;padding:0}
.nav-list li{margin:1px 0}
.nav-list a{display:block;padding:8px 12px;border-radius:9px;color:var(--muted);font-size:14px;font-weight:500;line-height:1.35}
.nav-list a:hover{background:var(--surface-2);color:var(--text);text-decoration:none}
.nav-list a.active{background:var(--accent);color:#fff;box-shadow:var(--shadow)}

.content{padding:40px 52px;min-width:0}
.md{max-width:820px}
.md>:first-child{margin-top:0}
.md h1{font-size:2.1rem;font-weight:700;letter-spacing:-.02em;margin:.2em 0 .6em}
.md h2{font-size:1.5rem;font-weight:700;margin:2em 0 .7em;padding-top:.3em;border-top:1px solid var(--border)}
.md h3{font-size:1.2rem;font-weight:600;margin:1.6em 0 .5em}
.md h4{font-size:1.02rem;font-weight:600;margin:1.3em 0 .4em}
.md h1,.md h2,.md h3,.md h4{scroll-margin-top:80px}
.md p,.md li{font-size:15.5px}
.md a{font-weight:500}
.md code{background:var(--surface-2);padding:.15em .4em;border-radius:6px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:85%}
.md pre{background:var(--code-bg);color:var(--code-fg);padding:18px 20px;border-radius:12px;overflow:auto;box-shadow:var(--shadow);border:1px solid var(--border)}
.md pre code{background:none;padding:0;color:inherit;font-size:13.5px;line-height:1.6}
.md blockquote{margin:1.2em 0;padding:14px 18px;background:var(--accent-weak);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:10px}
.md blockquote p{margin:.4em 0}
.md table{border-collapse:collapse;display:block;overflow:auto;margin:1.2em 0;border-radius:10px}
.md th,.md td{border:1px solid var(--border);padding:9px 14px;font-size:14px;text-align:left}
.md th{background:var(--surface-2);font-weight:600}
.md tr:nth-child(2n) td{background:var(--surface)}
.md hr{height:1px;border:0;background:var(--border);margin:2.4em 0}
.md img{max-width:100%;border-radius:10px}
.md ul,.md ol{padding-left:1.4em}.md li{margin:.3em 0}

.prevnext{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:820px;margin:48px 0 10px}
.pn{display:flex;flex-direction:column;gap:4px;padding:14px 18px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.pn:hover{border-color:var(--accent);text-decoration:none;box-shadow:var(--shadow)}
.pn span{font-size:12px;color:var(--muted);font-weight:600}
.pn strong{color:var(--text);font-size:14px}.pn.next{text-align:right}.pn.empty{border:0;background:none}

.toc{position:sticky;top:60px;align-self:start;height:calc(100vh - 60px);overflow:auto;padding:34px 18px}
.toc-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin-bottom:10px}
.toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--border)}
.toc li a{display:block;padding:5px 12px;margin-left:-1px;border-left:2px solid transparent;color:var(--muted);font-size:13px;line-height:1.4}
.toc li.lvl3 a{padding-left:24px}
.toc li a:hover{color:var(--text);text-decoration:none}
.toc li a.active{color:var(--accent);border-left-color:var(--accent);font-weight:600}

.footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:22px 52px;border-top:1px solid var(--border);color:var(--muted);font-size:13px}
.footer a{color:var(--muted)}.footer .sep{opacity:.5}

.scrim{display:none}
@media(max-width:1100px){body .layout{grid-template-columns:280px minmax(0,1fr)}.toc{display:none}}
@media(max-width:820px){
  .burger{display:flex}
  .layout{grid-template-columns:1fr}
  .content,.footer{padding-left:20px;padding-right:20px}
  .sidebar{position:fixed;top:60px;left:0;bottom:0;width:300px;max-width:85vw;background:var(--bg);z-index:25;transform:translateX(-105%);transition:transform .22s ease}
  .sidebar.open{transform:none;box-shadow:var(--shadow)}
  .scrim.show{display:block;position:fixed;inset:60px 0 0 0;background:rgba(0,0,0,.4);z-index:24}
  .tabs{position:absolute;left:0;right:0;top:60px;background:var(--bg);border-bottom:1px solid var(--border);padding:6px 10px}
}
`;
}

// ---- vendor, then emit ----------------------------------------------------
const alpineOk = await vendorAlpine();
const fontFace = await vendorFonts();

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "styles.css"), buildCss(fontFace));
fs.writeFileSync(path.join(OUT_DIR, "app.js"), APPJS);
fs.mkdirSync(path.join(OUT_DIR, "partials"), { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "partials", "header.html"), headerPartial());
fs.writeFileSync(path.join(OUT_DIR, "partials", "footer.html"), footerPartial());

// copy vendored assets into the build
fs.mkdirSync(path.join(OUT_DIR, "vendor"), { recursive: true });
if (alpineOk) fs.copyFileSync(path.join(VENDOR_DIR, "alpine.min.js"), path.join(OUT_DIR, "vendor", "alpine.min.js"));
if (exists(path.join(VENDOR_DIR, "fonts"))) {
  fs.cpSync(path.join(VENDOR_DIR, "fonts"), path.join(OUT_DIR, "vendor", "fonts"), { recursive: true });
}

let count = 0, priv = 0;
for (const page of pages) {
  let body = marked.parse(page.md);
  const processed = processHeadings(body);
  body = rewriteLinks(processed.html);
  const outPath = path.join(OUT_DIR, page.relHtml);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pageHtml(page, body, processed.toc));
  count++;
  if (page.private) priv++;
}

const landing = pages.find((p) => /(^|\/)00-index\.md$/.test(p.rel)) || firstOf("Chapters");
if (landing) fs.copyFileSync(path.join(OUT_DIR, landing.relHtml), path.join(OUT_DIR, "index.html"));

for (const f of assetFiles) {
  const rel = path.relative(DOCS_DIR, f);
  const dest = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f, dest);
}

console.log(`✓ Built ${count} page(s) (${priv} private, not in menus) -> ${path.relative(REPO_ROOT, OUT_DIR)}/`);
console.log(`  Tabs: ${grouped.map((g) => g.group).join(" · ")}`);
console.log(`  Fonts: ${fontFace ? "vendored (offline)" : "system fallback"} · Alpine: ${alpineOk ? "vendored" : "missing"}`);
