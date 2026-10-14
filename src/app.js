import { STRINGS } from "./i18n.js";

const DATA = JSON.parse(document.getElementById("reel-data").textContent);
const { reel, categories, langs, defaultLang, base } = DATA;
const root = document.documentElement;
const $ = (sel) => document.querySelector(sel);
const stage = $(".scene");
const strip = $(".strip");
const links = [...document.querySelectorAll(".frame-link")];
const chips = [...document.querySelectorAll(".chip")];
const hud = $(".hud");
const playBtn = $(".hud-play");
const outLink = $(".hud-out");
const player = $(".player");
const frame = player.querySelector("iframe");
const controls = $(".controls");
const soundBtn = $(".sound");
const stopBtn = $(".stop");
const langBtn = $(".lang");
const tip = $(".tip");
const prev = $(".reel-prev");
const next = $(".reel-next");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lowPower = matchMedia("(hover: none)").matches || navigator.hardwareConcurrency <= 4;

let lang = DATA.lang;
let cur = -1;
let target = null; // 程序滚动的目标画格，滚到之前不跟随中途经过的画格
let targetTimer = 0;
let phase = "booth"; // booth | flying-in | playing | flying-out
let iframeTimer = 0;
let video = null; // 正在投放的 mp4

const T = () => STRINGS[lang];
// 站点根目录的绝对地址：切换语言会改地址栏路径（/ ↔ /en/），相对路径必须先固定下来
const ROOT = new URL(base, location.href).href;
const url = (p) => (!p ? "" : /^https?:\/\//.test(p) ? p : ROOT + p);
const source = (v) => v.sources[lang] || v.sources[defaultLang];
const catName = (id) => categories.find((c) => c.id === id)?.name[lang] ?? id;

/* ---------- 3D 放映厅（不支持 WebGL 时退回平面银幕） ---------- */

// 3D 部分（three.js）是单独的分包：界面先能用，放映厅在后台下载好再淡入。
// 下载期间用当前封面铺一层虚化的“预映”背景；这期间点放映会先记下，3D 就绪后自动开始。
performance.mark("sr:app-start");
let theater = null;
let theaterLoading = true;
let pendingPlay = false;
const preshow = $(".preshow");
const setPreshow = (src) => { if (preshow && src) preshow.style.backgroundImage = `url("${src}")`; };

const images = new Map();
const loadImage = (src) => {
  if (!images.has(src)) {
    images.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    }));
  }
  return images.get(src);
};

// 没有封面的本地视频：在浏览器里取第 1 秒的画面（只读一小段数据）
const captureFrame = (src) => {
  const key = `frame:${src}`;
  if (!images.has(key)) {
    images.set(key, new Promise((resolve) => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.crossOrigin = "anonymous";
      v.src = `${src}#t=1`;
      v.addEventListener("loadeddata", () => {
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        resolve(c);
      }, { once: true });
      v.addEventListener("error", () => resolve(null), { once: true });
    }));
  }
  return images.get(key);
};

const coverOf = (v) => {
  if (v.cover) return loadImage(url(v.cover)).catch(() => null);
  const s = source(v);
  if (s.kind === "video") {
    return captureFrame(url(s.src)).then((c) => {
      // 胶片上的空白画格也换成截到的画面
      const blank = c && links[reel.indexOf(v)]?.querySelector(".frame-blank");
      if (blank) {
        const img = new Image();
        img.alt = "";
        img.draggable = false;
        img.src = c.toDataURL("image/jpeg", 0.7);
        blank.replaceWith(img);
      }
      return c;
    });
  }
  return Promise.resolve(null);
};

/* ---------- 放映 ---------- */

const placeOverlay = () => {
  let rect;
  if (theater) rect = theater.screenRect();
  else {
    const ar = reel[cur].aspect;
    const width = Math.min(innerWidth * 0.94, innerHeight * 0.84 * ar);
    const height = width / ar;
    rect = { left: (innerWidth - width) / 2, top: (innerHeight - height) / 2, width, height };
  }
  const px = (n) => `${n}px`;
  Object.assign(player.style, { left: px(rect.left), top: px(rect.top), width: px(rect.width), height: px(rect.height) });
  // 控制条贴在画面底边
  const w = Math.min(Math.max(rect.width, 300), innerWidth - 24);
  Object.assign(controls.style, {
    left: px(Math.max(12, rect.left + (rect.width - w) / 2)),
    width: px(w),
    top: px(Math.min(innerHeight - 56, rect.top + rect.height + 10)),
  });
};

const arrive = () => {
  phase = "playing";
  root.classList.remove("is-flying");
  root.classList.add("is-playing");
  placeOverlay();
  if (video) {
    controls.hidden = false;
    pokeControls();
  }
  stopBtn.focus({ preventScroll: true });
};

const play = () => {
  if (phase !== "booth") return;
  if (!theater && theaterLoading) {
    pendingPlay = true;
    root.classList.add("is-warming");
    return;
  }
  const v = reel[cur];
  const s = source(v);

  // 抖音等不能嵌入的平台：直接去原网页看
  if (s.kind === "link") {
    window.open(s.page, "_blank", "noopener");
    return;
  }

  phase = "flying-in";
  root.classList.add("is-flying");
  root.classList.toggle("is-film", s.kind === "video");

  if (s.kind === "video") {
    // mp4 直接投到 3D 银幕上；趁着这次点击先“解锁”有声播放，倒计时结束再从头放
    video = document.createElement("video");
    video.className = "film";
    video.playsInline = true;
    video.preload = "auto";
    if (/^https?:\/\//.test(s.src) && new URL(s.src).origin !== location.origin) video.crossOrigin = "anonymous";
    video.src = url(s.src);
    document.body.appendChild(video);
    bindVideo(video);
    const film = video;
    let rolled = false;
    // 解锁用的这次 play 可能在倒计时结束后才返回（视频加载慢），那时片子已经开始放了，不能再暂停
    film.play().then(() => {
      if (!rolled) {
        film.pause();
        film.currentTime = 0;
      }
    }).catch(() => {});
    const roll = () => {
      if (!video) return;
      rolled = true;
      video.currentTime = 0;
      video.play().catch(() => {
        // 浏览器不允许有声自动播放：先静音放，给一个开声音的按钮
        video.muted = true;
        video.play().catch(() => {});
        soundBtn.hidden = false;
      });
    };
    if (theater) theater.play(arrive, { video, onRoll: roll });
    else {
      // 平面模式：直接把视频盖在中间
      video.classList.add("film-flat");
      video.controls = true;
      roll();
      arrive();
    }
    return;
  }

  // 平台播放器：飞到银幕前，盖一层 iframe
  frame.title = `${v.title[lang]} · ${T().player}`;
  clearTimeout(iframeTimer);
  iframeTimer = setTimeout(() => { frame.src = s.embed; }, theater && !reduceMotion ? 1500 : 0);
  if (theater) theater.play(arrive);
  else arrive();
};

const stop = () => {
  if (phase !== "playing" && phase !== "flying-in") return;
  clearTimeout(iframeTimer);
  phase = "flying-out";
  root.classList.remove("is-playing", "player-ready", "is-film");
  root.classList.add("is-flying");
  frame.src = "about:blank";
  controls.hidden = true;
  soundBtn.hidden = true;
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    video = null;
  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const back = () => {
    phase = "booth";
    root.classList.remove("is-flying");
    playBtn.focus({ preventScroll: true });
  };
  if (theater) theater.stop(back);
  else back();
};

// 平台播放器加载好再淡入，加载期间银幕上仍是封面
frame.addEventListener("load", () => {
  if (frame.getAttribute("src") && frame.getAttribute("src") !== "about:blank") root.classList.add("player-ready");
});

/* ---------- mp4 控制条 ---------- */

const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00");
const seek = $(".ctl-seek");
let seeking = false;
let hideTimer = 0;

const pokeControls = () => {
  if (controls.hidden) return;
  controls.classList.remove("is-idle");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (video && !video.paused) controls.classList.add("is-idle"); }, 2600);
};

const syncControls = () => {
  if (!video) return;
  controls.classList.toggle("is-paused", video.paused);
  controls.classList.toggle("is-muted", video.muted);
  $(".ctl-toggle").setAttribute("aria-label", video.paused ? T().resume : T().pause);
  $(".ctl-mute").setAttribute("aria-label", video.muted ? T().unmute : T().mute);
  $(".ctl-full").setAttribute("aria-label", T().fullscreen);
  seek.setAttribute("aria-label", T().seek);
};

function bindVideo(v) {
  v.addEventListener("timeupdate", () => {
    $(".ctl-time").textContent = fmt(v.currentTime);
    if (!seeking && v.duration) seek.value = String(Math.round((v.currentTime / v.duration) * 1000));
  });
  v.addEventListener("loadedmetadata", () => { $(".ctl-dur").textContent = fmt(v.duration); });
  for (const ev of ["play", "pause", "volumechange"]) v.addEventListener(ev, () => { syncControls(); pokeControls(); });
  v.addEventListener("ended", () => { controls.classList.remove("is-idle"); });
  syncControls();
}

$(".ctl-toggle").addEventListener("click", () => {
  if (!video) return;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
});
$(".ctl-mute").addEventListener("click", () => {
  if (!video) return;
  video.muted = !video.muted;
  soundBtn.hidden = true;
});
soundBtn.addEventListener("click", () => {
  if (!video) return;
  video.muted = false;
  video.play().catch(() => {});
  soundBtn.hidden = true;
});
seek.addEventListener("input", () => {
  seeking = true;
  if (video?.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
});
seek.addEventListener("change", () => { seeking = false; });
$(".ctl-full").addEventListener("click", () => {
  if (!video) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (root.requestFullscreen) root.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
  else video.webkitEnterFullscreen?.(); // iPhone 只支持视频元素自身全屏
});
addEventListener("pointermove", pokeControls, { passive: true });

/* ---------- 换片 ---------- */

let hashTimer = 0;
const setHash = (hash) => {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    try { history.replaceState(null, "", hash || location.pathname + location.search); } catch { /* iOS 节流 */ }
  }, 400);
};

const setCurrent = (els, match) =>
  els.forEach((el) => (match(el) ? el.setAttribute("aria-current", "true") : el.removeAttribute("aria-current")));

const renderHud = () => {
  const v = reel[cur];
  const s = source(v);
  const P = T().providers[s.provider] || s.provider;
  $(".hud-num").textContent = v.num;
  const titleEl = $(".hud-title");
  titleEl.textContent = v.title[lang];
  titleEl.classList.toggle("is-long", [...v.title[lang]].length > (lang === "zh" ? 14 : 26));
  $(".hud-cat").textContent = catName(v.category);
  playBtn.setAttribute("aria-label", T().playLabel(v.title[lang]));
  playBtn.querySelector("span").textContent = s.kind === "link" ? T().watchOn(P) : T().play;
  const page = s.page || (s.kind === "video" ? url(s.src) : "");
  outLink.hidden = !page || s.kind === "link" || s.provider === "file";
  if (page) {
    outLink.href = page;
    outLink.textContent = T().openOn(P);
  }
};

let loadTimer = 0;
const show = (i, { instant = false, defer = false } = {}) => {
  if (i === cur) return;
  cur = i;
  const v = reel[i];
  renderHud();
  setCurrent(links, (a) => Number(a.dataset.i) === i);
  setCurrent(chips, (c) => c.dataset.cat === v.category);
  prev.disabled = i === 0;
  next.disabled = i === reel.length - 1;
  setHash(`#${v.id}`);
  hud.classList.remove("swap");
  void hud.offsetWidth;
  hud.classList.add("swap");
  // 滑动途中只换文字，停稳后再重绘银幕（大贴图上传在手机上很贵）
  clearTimeout(loadTimer);
  const load = () => {
    coverOf(v).then((img) => {
      if (cur !== i) return;
      // 构建时没能读到画幅：用真实画面尺寸校正
      if (v.aspectAuto && img && source(v).kind === "video") {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w && h) v.aspect = w / h;
      }
      if (theater) theater.load(v, img, { instant, title: v.title[lang] });
      else if (theaterLoading) setPreshow(img?.src);
      else stage.style.backgroundImage = img?.src ? `url("${img.src}")` : "";
    });
  };
  if (defer) loadTimer = setTimeout(load, 160);
  else load();
  // 预取相邻两条的封面；首屏还没好时先不抢带宽
  setTimeout(() => {
    [i - 1, i + 1].forEach((j) => reel[j]?.cover && loadImage(url(reel[j].cover)).catch(() => {}));
  }, root.classList.contains("is-ready") ? 0 : 2500);
};

/* ---------- 语言切换 ---------- */

const applyLang = (to, { push = true } = {}) => {
  lang = to;
  const S = T();
  root.lang = lang === "zh" ? "zh-CN" : lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = S[el.dataset.i18n]; });
  document.querySelectorAll("[data-cat-name]").forEach((el) => { el.textContent = catName(el.dataset.catName); });
  document.querySelectorAll("[data-cat-alt]").forEach((el) => {
    const c = categories.find((x) => x.id === el.dataset.catAlt);
    el.textContent = langs.filter((l) => l !== lang).map((l) => c.name[l]).find((n) => n !== c.name[lang]) || "";
  });
  document.querySelectorAll("[data-site]").forEach((el) => { el.textContent = DATA.site[el.dataset.site][lang]; });
  links.forEach((a) => {
    const v = reel[Number(a.dataset.i)];
    a.setAttribute("aria-label", `${v.title[lang]} · ${catName(v.category)}`);
  });
  $(".chips").setAttribute("aria-label", S.categories);
  $(".reel").setAttribute("aria-label", S.reel(reel.length));
  prev.setAttribute("aria-label", S.prev);
  next.setAttribute("aria-label", S.next);
  if (langBtn) {
    const other = langs.find((l) => l !== lang);
    langBtn.textContent = STRINGS[lang].switchTo;
    langBtn.setAttribute("aria-label", STRINGS[lang].switchLabel);
    langBtn.dataset.next = other;
  }
  document.title = [DATA.site.name[lang], DATA.site.tagline[lang]].filter(Boolean).join(" · ");
  if (cur >= 0) {
    renderHud();
    const v = reel[cur];
    if (!v.cover && theater) coverOf(v).then((img) => cur === reel.indexOf(v) && theater.load(v, img, { instant: true, title: v.title[lang] }));
  }
  try { localStorage.setItem("reel-lang", lang); } catch { /* 隐私模式 */ }
  // 地址栏跟着换到对应语言的页面，分享出去的链接就是这个语言
  if (push) {
    const path = new URL(lang === defaultLang ? "" : `${lang}/`, ROOT).pathname;
    try { history.replaceState(null, "", path + location.search + location.hash); } catch { /* 忽略 */ }
  }
};

langBtn?.addEventListener("click", () => {
  if (phase !== "booth") return;
  applyLang(langBtn.dataset.next || langs.find((l) => l !== lang));
});

/* ---------- 胶片 ---------- */

let centers = [];
const measure = () => {
  const b = strip.getBoundingClientRect().left - strip.scrollLeft;
  centers = links.map((a) => {
    const r = a.getBoundingClientRect();
    return r.left + r.width / 2 - b;
  });
};
const centerOf = (i) => centers[i];

const nearest = () => {
  const mid = strip.scrollLeft + strip.clientWidth / 2;
  let best = 0;
  for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i] - mid) < Math.abs(centers[best] - mid)) best = i;
  return best;
};

const goTo = (i, smooth = true) => {
  if (phase !== "booth") return;
  i = Math.max(0, Math.min(reel.length - 1, i));
  target = i;
  clearTimeout(targetTimer);
  targetTimer = setTimeout(() => {
    // 锁定结束时补一次校准，防止用户中途滑走后停在别的画格却没更新
    target = null;
    if (phase === "booth") show(nearest(), { defer: true });
  }, 900);
  strip.scrollTo({ left: centerOf(i) - strip.clientWidth / 2, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  show(i, { instant: !smooth });
};

let ticking = false;
strip.addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const n = nearest();
    if (target !== null) {
      if (n === target) target = null;
      return;
    }
    if (phase === "booth") show(n, { defer: true });
  });
}, { passive: true });

// 手指一碰胶片就解除程序滚动的锁定
strip.addEventListener("touchstart", () => {
  target = null;
  clearTimeout(targetTimer);
}, { passive: true });
strip.addEventListener("scrollend", () => { if (phase === "booth" && target === null) show(nearest(), { defer: true }); });

// 鼠标拖动胶片（触屏用原生滑动）
let drag = null;
strip.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse" || e.button !== 0) return;
  drag = { x: e.clientX, left: strip.scrollLeft, moved: false };
});
addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) > 4) {
    drag.moved = true;
    target = null;
    strip.classList.add("is-dragging");
  }
  if (drag.moved) strip.scrollLeft = drag.left - dx;
});
const endDrag = () => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  if (!moved) return;
  const n = nearest();
  strip.classList.remove("is-dragging");
  goTo(n);
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  strip.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => strip.removeEventListener("click", swallow, { capture: true }), 0);
};
addEventListener("pointerup", endDrag);
addEventListener("pointercancel", endDrag);

// 滚轮 / 触控板：累计到一定距离换一格
let wheelAcc = 0;
let wheelLock = 0;
addEventListener("wheel", (e) => {
  if (phase !== "booth") return;
  e.preventDefault();
  const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  const now = performance.now();
  if (now < wheelLock) return;
  wheelAcc += delta;
  if (Math.abs(wheelAcc) < 40) return;
  goTo(cur + Math.sign(wheelAcc));
  wheelAcc = 0;
  wheelLock = now + 260;
}, { passive: false });

/* ---------- 触屏：在画面上左右滑动换片 ---------- */

let swipe = null;
let swipedAt = 0;
stage.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" || phase !== "booth") return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, left: strip.scrollLeft, from: cur, active: false, trail: [[e.clientX, performance.now()]] };
});
stage.addEventListener("pointermove", (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    swipe.active = true;
    target = null;
    strip.classList.add("is-dragging");
  }
  strip.scrollLeft = swipe.left - dx * 0.8;
  swipe.lastX = e.clientX;
  swipe.trail.push([e.clientX, performance.now()]);
  if (swipe.trail.length > 6) swipe.trail.shift();
});
const endSwipe = (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe;
  swipe = null;
  if (!s.active) return;
  swipedAt = performance.now();
  // 用最后约 100ms 的手指速度判断是不是“轻扫”
  const recent = s.trail.filter(([, t]) => swipedAt - t < 120);
  const [x0, t0] = recent[0] || s.trail[0];
  const lastX = s.lastX ?? s.x;
  const speed = (lastX - x0) / Math.max(16, swipedAt - t0);
  let n = nearest();
  if (n === s.from && Math.abs(speed) > 0.2) n = s.from - Math.sign(lastX - s.x);
  strip.classList.remove("is-dragging");
  goTo(n);
};
stage.addEventListener("pointerup", endSwipe);
stage.addEventListener("pointercancel", endSwipe);

/* ---------- 点击放映机 / 银幕 ---------- */

const toNdc = (e) => {
  const r = stage.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
};

function bindStage() {
  let hoverFrame = 0;
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const ndc = toNdc(e);
    theater.setPointer(ndc.x, ndc.y);
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const hit = phase === "booth" ? theater.hit(ndc) : null;
      theater.setHover(hit === "projector");
      stage.style.cursor = hit || (phase === "playing" && video) ? "pointer" : "";
      tip.hidden = !hit;
      if (hit) {
        tip.textContent = hit === "projector" ? T().tipProjector : T().tipScreen;
        tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
      }
    });
  });
  stage.addEventListener("pointerleave", () => {
    theater.setPointer(0, 0);
    theater.setHover(false);
    tip.hidden = true;
  });
  stage.addEventListener("click", (e) => {
    if (performance.now() - swipedAt < 400) return;
    // 放映中点银幕：暂停 / 继续
    if (phase === "playing" && video) {
      pokeControls();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      return;
    }
    if (phase !== "booth") return;
    if (theater.hit(toNdc(e))) {
      tip.hidden = true;
      theater.setHover(false);
      play();
    }
  });
}

/* ---------- 按钮与键盘 ---------- */

strip.addEventListener("click", (e) => {
  const a = e.target.closest(".frame-link");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const i = Number(a.dataset.i);
  if (i === cur) play();
  else goTo(i);
});
playBtn.addEventListener("click", play);
stopBtn.addEventListener("click", stop);
prev.addEventListener("click", () => goTo(cur - 1));
next.addEventListener("click", () => goTo(cur + 1));
chips.forEach((c) => c.addEventListener("click", () => goTo(Number(c.dataset.jump))));

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") {
    if (!document.fullscreenElement) stop();
  } else if (e.key === " " && phase === "playing" && video && e.target === document.body) {
    e.preventDefault();
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  } else if (e.key === "ArrowRight") { e.preventDefault(); goTo(cur + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(cur - 1); }
});

addEventListener("resize", () => {
  theater?.resize();
  if (phase === "playing") requestAnimationFrame(placeOverlay);
  measure();
  strip.scrollTo({ left: centerOf(cur) - strip.clientWidth / 2 });
});
document.addEventListener("fullscreenchange", () => requestAnimationFrame(placeOverlay));

document.addEventListener("visibilitychange", () => {
  if (!theater) return;
  if (document.hidden) theater.pause();
  else theater.resume();
});

/* ---------- 初始化 ---------- */

// 语言：?lang= > 上次的选择 > 浏览器语言（只在默认语言页面上自动切换）
const params = new URLSearchParams(location.search);
let saved = null;
try { saved = localStorage.getItem("reel-lang"); } catch { /* 忽略 */ }
const browser = navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
const wanted = params.get("lang") || (DATA.lang === defaultLang ? saved || browser : DATA.lang);
applyLang(langs.includes(wanted) ? wanted : DATA.lang, { push: wanted !== DATA.lang });

measure();
const fromHash = reel.findIndex((v) => `#${v.id}` === location.hash);
goTo(fromHash === -1 ? 0 : fromHash, false);
if (fromHash === -1) setHash("");

/* ---------- 加载 3D 放映厅 ---------- */

import("./scene.js")
  .then(({ createTheater }) => {
    const t = createTheater(stage, { lowPower });
    performance.mark("sr:scene-built");
    t.start(reduceMotion);
    theater = t;
    if (new URLSearchParams(location.search).has("debug")) window.__theater = t;
    bindStage();
    // 把当前这一条装进放映机，然后点灯
    const v = reel[cur];
    coverOf(v).then((img) => { if (reel[cur] === v) t.load(v, img, { instant: true, title: v.title[lang] }); });
    t.ignite(reduceMotion ? 0 : 250);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-ready")));
  })
  .catch((err) => {
    console.warn("3D 放映厅不可用，使用平面模式", err);
    root.classList.add("no-webgl", "is-ready");
    if (cur >= 0) coverOf(reel[cur]).then((img) => { stage.style.backgroundImage = img?.src ? `url("${img.src}")` : ""; });
  })
  .finally(() => {
    theaterLoading = false;
    root.classList.remove("is-warming");
    if (pendingPlay) {
      pendingPlay = false;
      play();
    }
  });
