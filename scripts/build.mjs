// 构建：reel.config.json → dist/
//   dist/index.html（默认语言）、dist/<lang>/index.html（其它语言，带各自的分享卡片信息）
//   dist/assets/app-<hash>.js（three.js + 页面逻辑）、dist/covers/（封面与胶片小图）、public/ 原样复制
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parseAspect, parseSource } from "./sources.mjs";
import { createMedia, hasFfmpeg } from "./media.mjs";
import { STRINGS, pick } from "../src/i18n.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const pub = join(root, "public");
const dist = join(root, "dist");
// 可以用 REEL_CONFIG=examples/xxx.json npm run build 试别的配置
const configPath = process.env.REEL_CONFIG ? join(root, process.env.REEL_CONFIG) : join(root, "reel.config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const media = createMedia(root);

const fail = (msg) => {
  console.error(`\n✖ ${process.env.REEL_CONFIG || "reel.config.json"}：${msg}\n`);
  process.exit(1);
};
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const isUrl = (s) => /^https?:\/\//i.test(s);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "video";

/* ---------- 配置校验 ---------- */

const { site = {}, categories = [], videos = [] } = config;
const langs = (site.languages?.length ? site.languages : ["zh"]).filter((l) => STRINGS[l]);
if (!langs.length) fail(`site.languages 只支持 ${Object.keys(STRINGS).join(" / ")}`);
const defaultLang = langs.includes(site.defaultLang) ? site.defaultLang : langs[0];
if (!videos.length) fail("videos 里至少要有一条视频");
if (!categories.length) fail("categories 里至少要有一个分类");
const catIds = categories.map((c) => c.id);
videos.forEach((v, i) => {
  if (!v.src) fail(`第 ${i + 1} 条视频缺少 src`);
  if (!catIds.includes(v.category)) fail(`第 ${i + 1} 条视频的 category "${v.category}" 不在 categories 里（可选：${catIds.join("、")}）`);
});

/* ---------- 输出目录 ---------- */

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "covers", "thumb"), { recursive: true });
if (existsSync(pub)) cpSync(pub, dist, { recursive: true });

/* ---------- 每条视频：来源、封面、画幅 ---------- */

const usedIds = new Set();
const ordered = categories.flatMap((c) => videos.filter((v) => v.category === c.id));
const reel = [];

for (const [i, v] of ordered.entries()) {
  let id = slug(v.id || `v${i + 1}`);
  while (usedIds.has(id)) id += "-2";
  usedIds.add(id);
  const label = pick(v.title, defaultLang) || id;
  console.log(`· ${label}`);

  // 来源：可以对不同语言给不同链接（例如中文用 B 站，英文用 YouTube）
  const srcByLang = typeof v.src === "object" ? v.src : Object.fromEntries(langs.map((l) => [l, v.src]));
  const sources = {};
  for (const l of langs) {
    const raw = srcByLang[l] ?? srcByLang[defaultLang] ?? Object.values(srcByLang)[0];
    let s;
    try {
      s = parseSource(raw);
    } catch (err) {
      fail(err.message);
    }
    if (s.kind === "video" && !isUrl(s.src) && !existsSync(join(pub, s.src))) fail(`找不到视频文件 public/${s.src}`);
    if (s.needs === "xpc-mid") {
      const m = await media.providerMeta(s);
      if (!m.mid) fail(`新片场 ${s.page} 没查到播放器参数，请改用 player.xinpianchang.com 的嵌入地址`);
      s.embed = `${s.playerBase}&aid=${s.id}&mid=${m.mid}`;
    }
    if (v.embed === true && s.kind === "link") Object.assign(s, { kind: "embed", embed: raw });
    sources[l] = { kind: s.kind, provider: s.provider, src: s.src, embed: s.embed, page: v.link || s.page, _s: s };
  }
  const primary = sources[defaultLang]._s;
  const platform = primary.kind === "video" ? {} : await media.providerMeta(primary);

  // 封面：配置优先；没有就从视频截一帧，或取平台官方封面；都没有则运行时生成
  let coverFile;
  let coverOut;
  if (v.cover) {
    coverFile = isUrl(v.cover) ? await media.downloadImage(v.cover).catch((e) => fail(`下载封面失败：${e.message}`)) : join(pub, v.cover);
    if (!existsSync(coverFile)) fail(`找不到封面 public/${v.cover}`);
    if (isUrl(v.cover)) {
      coverOut = `covers/${id}${extname(new URL(v.cover).pathname) || ".jpg"}`;
      copyFileSync(coverFile, join(dist, coverOut));
    } else coverOut = v.cover;
  } else if (primary.kind === "video" && !isUrl(primary.src)) {
    coverOut = `covers/${id}.jpg`;
    if (media.extractFrame(join(pub, primary.src), join(dist, coverOut))) coverFile = join(dist, coverOut);
    else coverOut = undefined;
  } else if (platform.cover) {
    try {
      coverFile = await media.downloadImage(platform.cover).catch(() => platform.coverFallback && media.downloadImage(platform.coverFallback));
      coverOut = `covers/${id}.jpg`;
      media.fitImage(coverFile, join(dist, coverOut));
    } catch {
      coverFile = coverOut = undefined;
    }
  }

  // 画幅：配置 > 视频文件 > 平台信息 > 封面 > 16:9
  const known =
    parseAspect(v.aspect) ??
    (primary.kind === "video" && !isUrl(primary.src) ? media.probeVideo(join(pub, primary.src)) : undefined) ??
    primary.aspect ??
    platform.aspect ??
    (coverFile && primary.kind !== "embed" ? media.imageAspect(coverFile) : undefined);
  // 实在不知道就先按 16:9（抖音按 9:16），浏览器拿到画面后再按真实尺寸校正
  const aspect = known ?? (primary.provider === "douyin" ? 9 / 16 : 16 / 9);

  let thumbOut;
  if (coverFile) {
    thumbOut = `covers/thumb/${id}.jpg`;
    media.makeThumb(coverFile, join(dist, thumbOut), media.imageAspect(coverFile));
  }

  const title = v.title ?? platform.title ?? id;
  reel.push({
    id,
    num: pad(i + 1),
    title: Object.fromEntries(langs.map((l) => [l, pick(title, l, defaultLang)])),
    category: v.category,
    aspect: Math.round(aspect * 10000) / 10000,
    ...(known ? {} : { aspectAuto: true }),
    cover: coverOut,
    thumb: thumbOut || coverOut,
    sources: Object.fromEntries(Object.entries(sources).map(([l, s]) => [l, { kind: s.kind, provider: s.provider, src: s.src, embed: s.embed, page: s.page }])),
  });
}
if (!hasFfmpeg) console.log("  （没装 ffmpeg：未填封面的视频会在浏览器里截帧，胶片小图直接用原封面）");

/* ---------- 打包脚本（文件名带内容 hash） ---------- */

const bundle = await build({
  entryPoints: [join(root, "src", "app.js")],
  outdir: join(dist, "assets"),
  entryNames: "app-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  legalComments: "none",
  metafile: true,
});
const [outPath, outMeta] = Object.entries(bundle.metafile.outputs)[0];
const appFile = `assets/${outPath.split("/").pop()}`;
const css = readFileSync(join(root, "src", "style.css"), "utf8");

/* ---------- 每种语言一个页面 ---------- */

const cats = categories.map((c) => ({ id: c.id, name: Object.fromEntries(langs.map((l) => [l, pick(c.name, l, defaultLang)])) }));
const pagePath = (l) => (l === defaultLang ? "" : `${l}/`);
// GitHub Pages 的工作流会通过 SITE_URL 传入站点地址，分享卡片就能用绝对地址的图
const siteUrlRaw = site.url || process.env.SITE_URL || "";
const siteUrl = siteUrlRaw ? siteUrlRaw.replace(/\/?$/, "/") : "";
if (!siteUrl) console.log("  （site.url 没填：分享到 X / 微信时预览卡片可能没有图）");

const renderPage = (lang) => {
  const T = STRINGS[lang];
  const base = lang === defaultLang ? "./" : "../";
  const name = pick(site.name, lang, defaultLang);
  const tagline = pick(site.tagline, lang, defaultLang);
  const description = pick(site.description, lang, defaultLang);
  const title = tagline ? `${name} · ${tagline}` : name;
  const first = reel[0];
  const shareImage = site.shareImage || first.cover;
  const abs = (p) => (siteUrl && p ? siteUrl + p : p ? base + p : "");
  const pageUrl = siteUrl + pagePath(lang);
  const cname = (id) => cats.find((c) => c.id === id).name[lang];
  const otherLangs = langs.filter((l) => l !== lang);

  const leader = (c) => `
          <li class="leader" aria-hidden="true">
            <span class="leader-mark"></span>
            <span class="leader-name" data-cat-name="${c.id}">${esc(c.name[lang])}</span>
            <span class="leader-alt" data-cat-alt="${c.id}">${esc(otherLangs.map((l) => c.name[l]).find((n) => n !== c.name[lang]) || "")}</span>
          </li>`;
  const frames = reel
    .map((v, i) => `${i === 0 || reel[i - 1].category !== v.category ? leader(cats.find((c) => c.id === v.category)) : ""}
          <li class="frame">
            <a class="frame-link" href="${esc(v.sources[lang].page || v.sources[lang].src || "#")}" target="_blank" rel="noopener" data-i="${i}" aria-label="${esc(`${v.title[lang]} · ${cname(v.category)}`)}">
              ${v.thumb ? `<img src="${base}${v.thumb}" alt="" decoding="async" draggable="false">` : `<span class="frame-blank">${esc(v.title[lang])}</span>`}
            </a>
            <span class="frame-num" aria-hidden="true">${v.num}</span>
          </li>`)
    .join("");
  const chips = cats
    .filter((c) => reel.some((v) => v.category === c.id))
    .map((c) => {
      const i = reel.findIndex((v) => v.category === c.id);
      const n = reel.filter((v) => v.category === c.id).length;
      return `<button class="chip" type="button" data-jump="${i}" data-cat="${c.id}"><span data-cat-name="${c.id}">${esc(c.name[lang])}</span><small>${n}</small></button>`;
    })
    .join("");
  const alternates = langs
    .map((l) => `<link rel="alternate" hreflang="${l === "zh" ? "zh-CN" : l}" href="${siteUrl ? siteUrl + pagePath(l) : base + pagePath(l)}">`)
    .join("\n  ");
  const data = { reel, categories: cats, langs, defaultLang, lang, base, site: { name: Object.fromEntries(langs.map((l) => [l, pick(site.name, l, defaultLang)])), tagline: Object.fromEntries(langs.map((l) => [l, pick(site.tagline, l, defaultLang)])) } };

  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#040302">
  <meta name="color-scheme" content="dark">
  ${siteUrl ? `<link rel="canonical" href="${pageUrl}">` : ""}
  ${langs.length > 1 ? alternates : ""}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${siteUrl ? `<meta property="og:url" content="${pageUrl}">` : ""}
  ${shareImage ? `<meta property="og:image" content="${esc(abs(shareImage))}">` : ""}
  <meta property="og:locale" content="${lang === "zh" ? "zh_CN" : "en_US"}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  ${shareImage ? `<meta name="twitter:image" content="${esc(abs(shareImage))}">` : ""}
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23040302'/%3E%3Cpath d='M12 9v14l11-7z' fill='%23e9b24c'/%3E%3C/svg%3E">
  <link rel="modulepreload" href="${base}${appFile}">
  <style>${css}</style>
</head>
<body>
  <div class="scene" aria-hidden="true"></div>
  <div class="vignette" aria-hidden="true"></div>

  <header class="top">
    <h1 class="mark"><span data-site="name">${esc(name)}</span><span class="mark-sub" data-site="tagline">${esc(tagline)}</span></h1>
    <nav class="chips" aria-label="${esc(T.categories)}" data-i18n-label="categories">${chips}</nav>
    <div class="top-right">
      ${site.contact ? `<a class="top-mail" href="${/^https?:/.test(site.contact) ? esc(site.contact) : `mailto:${esc(site.contact)}`}">${esc(site.contact.replace(/^mailto:|^https?:\/\//, ""))}</a>` : ""}
      ${langs.length > 1 ? `<button class="lang" type="button" aria-label="${esc(T.switchLabel)}">${esc(T.switchTo)}</button>` : ""}
    </div>
  </header>

  <main class="hud" aria-live="polite">
    <p class="hud-count"><span class="hud-num">${first.num}</span> / ${pad(reel.length)}</p>
    <h2 class="hud-title">${esc(first.title[lang])}</h2>
    <p class="hud-cat">${esc(cname(first.category))}</p>
    <div class="hud-actions">
      <button class="hud-play" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg><span data-i18n="play">${esc(T.play)}</span></button>
      <a class="hud-out" target="_blank" rel="noopener"></a>
    </div>
  </main>

  <section class="reel" aria-label="${esc(T.reel(reel.length))}">
    <button class="reel-step reel-prev" type="button" aria-label="${esc(T.prev)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
    <div class="strip">
      <ol class="frames" role="list">${frames}
      </ol>
    </div>
    <span class="gate" aria-hidden="true"></span>
    <button class="reel-step reel-next" type="button" aria-label="${esc(T.next)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
    <p class="reel-hint"><span class="hint-mouse" data-i18n="hintMouse">${esc(T.hintMouse)}</span><span class="hint-touch" data-i18n="hintTouch">${esc(T.hintTouch)}</span></p>
  </section>

  <div class="player"><iframe allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  <div class="controls" hidden>
    <button class="ctl-toggle" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/><path class="i-play" d="M8 5.5v13l11-6.5z"/></svg></button>
    <span class="ctl-time">0:00</span>
    <input class="ctl-seek" type="range" min="0" max="1000" value="0" step="1">
    <span class="ctl-dur">0:00</span>
    <button class="ctl-mute" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="i-wave" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/><path class="i-x" d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg></button>
    <button class="ctl-full" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
  </div>
  <button class="sound" type="button" hidden data-i18n="tapForSound">${esc(T.tapForSound)}</button>
  <button class="stop" type="button"><span data-i18n="back">${esc(T.back)}</span><kbd>Esc</kbd></button>
  <p class="tip" hidden></p>

  <noscript>
    <ul class="noscript">${reel.map((v) => `<li><a href="${esc(v.sources[lang].page || base + v.sources[lang].src)}">${esc(v.title[lang])}</a></li>`).join("")}</ul>
  </noscript>
  <script type="application/json" id="reel-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
  <script type="module" src="${base}${appFile}"></script>
</body>
</html>
`;
};

for (const lang of langs) {
  const dir = join(dist, pagePath(lang));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), renderPage(lang));
}
console.log(`\n✓ dist/ · ${reel.length} 条视频 · ${langs.map((l) => `/${pagePath(l)}`).join(" ")} · ${appFile} ${(outMeta.bytes / 1024).toFixed(0)} KB`);
