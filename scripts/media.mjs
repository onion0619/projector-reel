// 构建期的素材处理：读尺寸、截封面、生成胶片小图、从平台官方接口取一次封面 / 标题（结果缓存在 .cache/）。
// 没有 ffmpeg 也能构建：封面改为运行时从视频截帧，小图直接用原封面。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
export const hasFfmpeg = run("ffmpeg", ["-version"]).status === 0 && run("ffprobe", ["-version"]).status === 0;

export function createMedia(root) {
  const cacheDir = join(root, ".cache");
  const metaFile = join(cacheDir, "meta.json");
  mkdirSync(join(cacheDir, "img"), { recursive: true });
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {};
  const save = () => writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  const fetchWithTimeout = async (url, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (screening-room build)", ...(opts.headers || {}) } });
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchJson = async (url) => {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  };

  // 远程图片下载一次后缓存（平台封面多有防盗链，所以要存到自己站上）
  const downloadImage = async (url) => {
    const file = join(cacheDir, "img", createHash("sha1").update(url).digest("hex").slice(0, 16) + ".jpg");
    if (existsSync(file)) return file;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  };

  /** 平台元数据：封面地址、标题、新片场播放器参数。每个链接只查一次。 */
  const providerMeta = async (source) => {
    const key = `${source.provider}:${source.id}`;
    if (meta[key]) return meta[key];
    let m = {};
    try {
      if (source.provider === "youtube") {
        const o = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(source.page)}`);
        m = { title: o.title, cover: `https://i.ytimg.com/vi/${source.id}/maxresdefault.jpg`, coverFallback: o.thumbnail_url };
      } else if (source.provider === "vimeo") {
        const o = await fetchJson(`https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(source.page)}`);
        m = { title: o.title, cover: o.thumbnail_url, aspect: o.width && o.height ? o.width / o.height : undefined };
      } else if (source.provider === "tiktok") {
        const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(source.page)}`);
        m = { title: o.title, cover: o.thumbnail_url };
      } else if (source.provider === "bilibili") {
        const q = source.id.startsWith("BV") ? `bvid=${source.id}` : `aid=${source.id.slice(2)}`;
        const o = await fetchJson(`https://api.bilibili.com/x/web-interface/view?${q}`);
        const d = o.data || {};
        m = { title: d.title, cover: d.pic, aspect: d.dimension?.width ? (d.dimension.rotate ? d.dimension.height / d.dimension.width : d.dimension.width / d.dimension.height) : undefined };
      } else if (source.provider === "xinpianchang") {
        const o = await fetchJson(`https://app.xinpianchang.com/article/${source.id}`);
        const d = o.data || {};
        m = { title: d.title, cover: d.cover, mid: d.video_library_id };
      }
    } catch (err) {
      console.warn(`  ⚠ 取 ${key} 的信息失败（${err.message}），这条请在配置里手动填写 cover / title`);
      return {};
    }
    meta[key] = m;
    save();
    return m;
  };

  const probeVideo = (file) => {
    if (!hasFfmpeg) return undefined;
    const r = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation", "-of", "json", file]);
    try {
      const s = JSON.parse(r.stdout).streams[0];
      const rot = Math.abs(s.side_data_list?.[0]?.rotation || 0) === 90;
      return rot ? s.height / s.width : s.width / s.height;
    } catch {
      return undefined;
    }
  };

  /** PNG / JPEG / WebP 的宽高（只读文件头） */
  const imageAspect = (file) => {
    const b = readFileSync(file);
    if (b.readUInt32BE(0) === 0x89504e47) return b.readUInt32BE(16) / b.readUInt32BE(20);
    if (b.toString("ascii", 8, 12) === "WEBP") {
      const chunk = b.toString("ascii", 12, 16);
      if (chunk === "VP8 ") return (b.readUInt16LE(26) & 0x3fff) / (b.readUInt16LE(28) & 0x3fff);
      if (chunk === "VP8L") { const v = b.readUInt32LE(21); return ((v & 0x3fff) + 1) / (((v >> 14) & 0x3fff) + 1); }
      if (chunk === "VP8X") return (b.readUIntLE(24, 3) + 1) / (b.readUIntLE(27, 3) + 1);
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return b.readUInt16BE(i + 7) / b.readUInt16BE(i + 5);
        i += 2 + len;
      }
    }
    return undefined;
  };

  const ensureDir = (file) => mkdirSync(dirname(file), { recursive: true });

  /** 从视频第 1 秒截一帧当封面 */
  const extractFrame = (video, out) => {
    if (!hasFfmpeg) return false;
    ensureDir(out);
    const r = run("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", video, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", out]);
    return r.status === 0 && existsSync(out);
  };

  /** 胶片画格用的小图：竖图宽 400，横图高 300 */
  const makeThumb = (input, out, aspect) => {
    ensureDir(out);
    if (hasFfmpeg) {
      const scale = aspect && aspect > 4 / 3 ? "-2:300" : "400:-2";
      const r = run("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", `scale=${scale}`, "-q:v", "5", out]);
      if (r.status === 0) return true;
    }
    copyFileSync(input, out);
    return true;
  };

  /** 平台封面常常很大：缩到最宽 1600 再放进站点；没有 ffmpeg 就原样复制 */
  const fitImage = (input, out) => {
    ensureDir(out);
    if (hasFfmpeg && run("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", out]).status === 0) return;
    copyFileSync(input, out);
  };

  /**
   * 网页用的 WebP：fit = 最长边不超过 size；cover = 铺满 size×(size*3/4) 的胶片画格
   * 没有 ffmpeg 或编码失败时返回 false，调用方退回原图
   */
  const toWebp = (input, out, { size, quality, cover = false }) => {
    if (!hasFfmpeg) return false;
    ensureDir(out);
    const vf = cover
      ? `scale=${size}:${Math.round((size * 3) / 4)}:force_original_aspect_ratio=increase`
      : `scale='min(iw,${size})':'min(ih,${size})':force_original_aspect_ratio=decrease`;
    const r = run("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", vf, "-frames:v", "1", "-c:v", "libwebp", "-quality", String(quality), "-compression_level", "6", out]);
    return r.status === 0 && existsSync(out);
  };

  return { providerMeta, downloadImage, probeVideo, imageAspect, extractFrame, makeThumb, fitImage, toWebp };
}
