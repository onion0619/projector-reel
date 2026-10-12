// 给你的放映厅录一段宣传短片：npm run record
//   逐帧渲染（接管页面时钟，每 1/60 秒截一帧无损图），画面清晰、动作匀速，片子在银幕上的部分逐帧对齐，并混入原片声音。
//   需要 Playwright 的 Chromium：首次运行前执行 npx playwright install chromium，并装好 ffmpeg。
//
//   参数（都可省略）：
//     --lang=en|zh          页面语言（默认 en，方便发 X）
//     --size=1920x1080      画面尺寸，竖版可用 1080x1920
//     --play=<视频 id>      放映哪一条（默认第 2 条）
//     --watch=6             在银幕前看几秒
//     --out=docs/preview.mp4
//     --webp=docs/preview.webp   同时导出 README 用的动态图（只截“换片 + 推进到银幕”这段）
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const lang = args.lang || "en";
const [W, H] = (args.size || "1920x1080").split("x").map(Number);
const FPS = Number(args.fps) || 60;
const out = join(root, args.out || "docs/preview.mp4");
const webpOut = args.webp ? join(root, args.webp) : null;
const watchSec = Number(args.watch) || 6;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("✖ 需要 Playwright：npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}
if (!existsSync(join(root, "dist", "index.html"))) {
  console.error("✖ 先运行 npm run build");
  process.exit(1);
}

const port = 5199;
const server = await serve(port);
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
page.on("pageerror", (e) => console.warn("  page:", e.message));

// 接管时钟：定时器、requestAnimationFrame、performance.now 都由脚本推进
const T0 = new Date("2026-01-01T00:00:00Z").getTime();
await page.clock.install({ time: T0 });
await page.clock.pauseAt(T0 + 10); // 冻结时钟：只有脚本推进时页面里的时间才走
await page.goto(`http://127.0.0.1:${port}/${lang === "zh" ? "" : "en/"}?debug&lang=${lang}`, { waitUntil: "load" });
await page.waitForTimeout(800); // 让封面图片真实加载完

const data = await page.evaluate(() => JSON.parse(document.getElementById("reel-data").textContent));
const reel = data.reel;
const playIndex = Math.max(0, args.play ? reel.findIndex((v) => v.id === args.play) : Math.min(1, reel.length - 1));

// 录制辅助：手动推进 CSS 动画、画一个柔和的光标、逐帧驱动投放中的视频
await page.evaluate(() => {
  window.__rec = {
    tickCss(ms) {
      for (const a of document.getAnimations()) {
        if (!a.__m) { a.__m = true; a.pause(); a.__t = 0; }
        a.__t += ms;
        a.currentTime = a.__t;
      }
    },
    cursor: null,
    moveCursor(x, y, down) {
      if (!this.cursor) {
        const c = document.createElement("div");
        c.style.cssText = "position:fixed;z-index:99;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid rgba(255,255,255,.9);box-shadow:0 0 12px rgba(0,0,0,.5);pointer-events:none;transition:none";
        document.body.appendChild(c);
        this.cursor = c;
      }
      this.cursor.style.transform = `translate(${x}px, ${y}px) scale(${down ? 0.7 : 1})`;
      this.cursor.style.background = down ? "rgba(233,178,76,.55)" : "transparent";
    },
    hideCursor() { if (this.cursor) this.cursor.style.display = "none"; },
    film: null,
    filmT: 0,
    async driveFilm(dt) {
      const v = document.querySelector("video.film");
      if (!v) return false;
      if (this.film !== v) {
        this.film = v;
        this.filmT = 0;
        v.pause();
        Object.defineProperty(v, "paused", { get: () => false }); // 界面上仍显示“正在播放”
      }
      this.filmT += dt;
      v.currentTime = this.filmT;
      // 注意：页面里的 setTimeout 已被接管，超时保护放在外面
      await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
      return true;
    },
  };
});

// 找放映机在屏幕上的位置：用场景的点击检测扫一遍
const findProjector = () => page.evaluate(([W, H]) => {
  const pts = [];
  for (let y = 0.05; y < 0.95; y += 0.025) for (let x = 0.4; x < 1; x += 0.02) {
    if (window.__theater.hit({ x: x * 2 - 1, y: -(y * 2 - 1) }) === "projector") pts.push([x * W, y * H]);
  }
  if (!pts.length) return [W * 0.7, H * 0.45];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [cx, cy];
}, [W, H]);

/* ---------- 编排时间线（秒） ---------- */

const actions = [];
const at = (t, fn) => actions.push({ t, fn, done: false });
let t = 4.4; // 开场：灯泡点亮、镜头滑入
const browseTo = Math.min(2, reel.length - 1);
for (let i = 1; i <= browseTo; i++) { at(t, () => page.keyboard.press("ArrowRight")); t += 1.5; }
for (let i = browseTo; i > playIndex; i--) { at(t, () => page.keyboard.press("ArrowLeft")); t += 1.3; }
const hoverStart = t;
let projector = [W * 0.7, H * 0.45];
at(hoverStart, async () => { projector = await findProjector(); });
const hoverDur = 0.9;
const clickAt = hoverStart + hoverDur + 0.5;
at(clickAt, async () => {
  await page.evaluate(([x, y]) => window.__rec.moveCursor(x, y, true), projector);
  await page.mouse.click(projector[0], projector[1]);
});
at(clickAt + 0.25, () => page.evaluate(() => window.__rec.hideCursor()));
const rollAt = clickAt + 1.8;
const arriveAt = clickAt + 2.9;
const escAt = arriveAt + watchSec;
at(escAt, () => page.keyboard.press("Escape"));
const end = escAt + 2.6;
const webpRange = [Math.max(0, 4.2), Math.min(end, arriveAt + 1.5)];

/* ---------- 逐帧渲染并送进 ffmpeg ---------- */

const film = reel[playIndex].sources[lang] || reel[playIndex].sources[data.defaultLang];
const audioSrc = film.kind === "video" && !/^https?:/.test(film.src) ? join(root, "public", film.src) : null;
const ffArgs = ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"];
if (audioSrc) ffArgs.push("-i", audioSrc);
ffArgs.push("-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
if (audioSrc) {
  const d = escAt - rollAt;
  ffArgs.push("-filter_complex", `[1:a]atrim=0:${d.toFixed(2)},afade=t=in:d=0.2,afade=t=out:st=${(d - 0.6).toFixed(2)}:d=0.6,adelay=${Math.round(rollAt * 1000)}:all=1,apad[a]`, "-map", "0:v", "-map", "[a]", "-shortest", "-c:a", "aac", "-b:a", "160k");
}
ffArgs.push(out);
const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });

const frames = Math.round(end * FPS);
let prevMs = 0;
const started = Date.now();
for (let f = 0; f < frames; f++) {
  const nowSec = f / FPS;
  for (const a of actions) if (!a.done && nowSec >= a.t) { a.done = true; await a.fn(); }
  // 悬停：光标平滑移到放映机上
  if (nowSec >= hoverStart && nowSec <= clickAt) {
    const k = Math.min(1, (nowSec - hoverStart) / hoverDur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const x = W * 0.42 + (projector[0] - W * 0.42) * e;
    const y = H * 0.62 + (projector[1] - H * 0.62) * e;
    await page.mouse.move(x, y);
    await page.evaluate(([x, y]) => window.__rec.moveCursor(x, y, false), [x, y]);
  }
  const ms = Math.round(((f + 1) * 1000) / FPS);
  const step = ms - prevMs;
  prevMs = ms;
  await page.clock.runFor(step);
  await page.evaluate((s) => window.__rec.tickCss(s), step);
  if (nowSec >= rollAt && nowSec < escAt) {
    await Promise.race([page.evaluate((s) => window.__rec.driveFilm(s / 1000), step), new Promise((r) => setTimeout(r, 500))]);
  }
  await page.clock.runFor(0);
  const png = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % FPS === 0) process.stdout.write(`\r  录制中 ${(nowSec).toFixed(0)}s / ${end.toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
server.close();
console.log(`\n✓ ${out}  (${frames} 帧, ${((Date.now() - started) / 1000).toFixed(0)}s)`);

// README 用的动态 WebP：截取“换片 → 推进到银幕”这段，960 宽、20 帧
if (webpOut) {
  await new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-v", "error", "-y", "-ss", String(webpRange[0]), "-to", String(webpRange[1]), "-i", out, "-vf", "fps=20,scale=960:-2:flags=lanczos", "-c:v", "libwebp_anim", "-quality", "72", "-compression_level", "6", "-loop", "0", "-an", webpOut], { stdio: "inherit" });
    p.on("close", resolve);
  });
  console.log(`✓ ${webpOut}`);
}
