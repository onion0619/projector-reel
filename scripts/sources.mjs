// 把配置里的视频链接识别成“来源”：本地 / 远程 mp4、各平台官方播放器、或只能跳转的平台。
// 只使用平台官方提供的嵌入播放器，不解析、不提取任何视频直链。

const XPC_PLAYER =
  "https://player.xinpianchang.com/?appKey=61a2f329348b3bf77" +
  "&apiBackend=https%3A%2F%2Fmod-api.xinpianchang.com" +
  "&passportUrl=https%3A%2F%2Fpassport.xinpianchang.com" +
  "&logBackend=https%3A%2F%2Flog.xpccdn.com";

const isUrl = (s) => /^https?:\/\//i.test(s);

/**
 * @returns {{ kind: "video" | "embed" | "link", provider: string, id?: string, src?: string, embed?: string, page?: string, aspect?: number, needs?: string }}
 */
export function parseSource(raw) {
  const src = String(raw).trim();

  // 本地文件（相对 public/）或远程 mp4 / webm / mov
  if (/\.(mp4|m4v|webm|mov)(\?.*)?$/i.test(src)) {
    return { kind: "video", provider: "file", src, page: isUrl(src) ? src : undefined };
  }
  if (!isUrl(src)) throw new Error(`无法识别的视频地址：${src}（本地文件请放在 public/ 下并写相对路径，如 media/xxx.mp4）`);

  const url = new URL(src);
  const host = url.hostname.replace(/^www\.|^m\./, "");

  // YouTube：watch?v= / youtu.be / shorts / embed
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id =
      host === "youtu.be" ? url.pathname.slice(1) :
      url.searchParams.get("v") || url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1];
    if (!id) throw new Error(`没找到 YouTube 视频 ID：${src}`);
    const shorts = url.pathname.startsWith("/shorts/");
    return {
      kind: "embed", provider: "youtube", id,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`,
      page: `https://www.youtube.com/watch?v=${id}`,
      aspect: shorts ? 9 / 16 : undefined,
    };
  }

  // B 站：BV 号或 av 号
  if (host === "bilibili.com" || host === "b23.tv" || host === "player.bilibili.com") {
    const bvid = src.match(/BV[0-9A-Za-z]{10}/)?.[0];
    const aid = !bvid && src.match(/av(\d+)/i)?.[1];
    if (!bvid && !aid) throw new Error(`没找到 B 站 BV 号：${src}（b23.tv 短链请先在浏览器打开，复制完整地址）`);
    const q = bvid ? `bvid=${bvid}` : `aid=${aid}`;
    return {
      kind: "embed", provider: "bilibili", id: bvid || `av${aid}`,
      embed: `https://player.bilibili.com/player.html?${q}&autoplay=1&high_quality=1&danmaku=0`,
      page: bvid ? `https://www.bilibili.com/video/${bvid}` : `https://www.bilibili.com/video/av${aid}`,
    };
  }

  // Vimeo
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/(\d{6,})/)?.[1];
    if (!id) throw new Error(`没找到 Vimeo 视频 ID：${src}`);
    return {
      kind: "embed", provider: "vimeo", id,
      embed: `https://player.vimeo.com/video/${id}?autoplay=1&title=0&byline=0&portrait=0`,
      page: `https://vimeo.com/${id}`,
    };
  }

  // TikTok：官方嵌入播放器 /player/v1/{id}
  if (host === "tiktok.com") {
    const id = url.pathname.match(/\/video\/(\d+)/)?.[1] || url.pathname.match(/\/player\/v1\/(\d+)/)?.[1];
    if (!id) throw new Error(`没找到 TikTok 视频 ID：${src}（vm.tiktok.com 短链请先展开）`);
    return {
      kind: "embed", provider: "tiktok", id,
      embed: `https://www.tiktok.com/player/v1/${id}?autoplay=1&rel=0`,
      page: src.split("?")[0],
      aspect: 9 / 16,
    };
  }

  // 新片场：需要在构建时查一次 mid（播放器参数）
  if (host === "xinpianchang.com") {
    const id = url.pathname.match(/\/a(\d+)/)?.[1];
    if (!id) throw new Error(`没找到新片场作品 ID：${src}`);
    return { kind: "embed", provider: "xinpianchang", id, page: `https://www.xinpianchang.com/a${id}`, needs: "xpc-mid", playerBase: XPC_PLAYER };
  }
  if (host === "player.xinpianchang.com") {
    return { kind: "embed", provider: "xinpianchang", embed: src, page: src };
  }

  // 抖音：没有面向个人网站的公开嵌入方式，只做封面 + 跳转观看
  if (host.endsWith("douyin.com") || host.endsWith("iesdouyin.com")) {
    return { kind: "link", provider: "douyin", page: src };
  }

  // 其它：如果是能直接 iframe 的播放器地址，配置里写 "embed": true
  return { kind: "link", provider: "web", page: src };
}

/** "16:9" / "9:16" / 1.777 → 宽高比数字 */
export function parseAspect(v) {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return v > 0 ? v : undefined;
  const m = String(v).match(/^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(v);
  return n > 0 ? n : undefined;
}
