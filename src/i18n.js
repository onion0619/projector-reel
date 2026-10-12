// 界面文字。构建时用来写静态 HTML，运行时用来切换语言；两边共用这一份。

// 中文里夹英文名时两边留空格：在 YouTube 打开
const spaced = (p) => (/^[A-Za-z]/.test(p) ? ` ${p} ` : p);
export const STRINGS = {
  zh: {
    langName: "中文",
    switchTo: "EN",
    switchLabel: "Switch to English",
    categories: "作品分类",
    play: "放映",
    playLabel: (t) => `放映《${t}》`,
    watchOn: (p) => `去${spaced(p)}观看 ↗`,
    openOn: (p) => `在${spaced(p)}打开 ↗`,
    back: "回到放映间",
    reel: (n) => `作品胶片，${n} 条`,
    prev: "上一条",
    next: "下一条",
    hintMouse: "滚动或拖动胶片换片 · 点放映机放映",
    hintTouch: "左右滑动换片 · 点放映机放映",
    tipProjector: "放映",
    tipScreen: "放映这一部",
    pause: "暂停",
    resume: "播放",
    mute: "静音",
    unmute: "取消静音",
    fullscreen: "全屏",
    seek: "播放进度",
    tapForSound: "点这里打开声音",
    player: "视频播放器",
    providers: { file: "原文件", youtube: "YouTube", bilibili: "B 站", vimeo: "Vimeo", tiktok: "TikTok", xinpianchang: "新片场", douyin: "抖音", web: "原网页" },
  },
  en: {
    langName: "English",
    switchTo: "中",
    switchLabel: "切换到中文",
    categories: "Categories",
    play: "Play",
    playLabel: (t) => `Play “${t}”`,
    watchOn: (p) => `Watch on ${p} ↗`,
    openOn: (p) => `Open on ${p} ↗`,
    back: "Back to booth",
    reel: (n) => `Film reel, ${n} titles`,
    prev: "Previous",
    next: "Next",
    hintMouse: "Scroll or drag the film to browse · click the projector to play",
    hintTouch: "Swipe to browse · tap the projector to play",
    tipProjector: "Play",
    tipScreen: "Play this one",
    pause: "Pause",
    resume: "Play",
    mute: "Mute",
    unmute: "Unmute",
    fullscreen: "Full screen",
    seek: "Seek",
    tapForSound: "Tap for sound",
    player: "Video player",
    providers: { file: "source", youtube: "YouTube", bilibili: "Bilibili", vimeo: "Vimeo", tiktok: "TikTok", xinpianchang: "Xinpianchang", douyin: "Douyin", web: "the web" },
  },
};

/** 配置里的文字可以是字符串，也可以是 { zh, en } */
export const pick = (value, lang, fallback = "zh") =>
  value == null ? "" : typeof value === "string" ? value : value[lang] ?? value[fallback] ?? Object.values(value)[0] ?? "";
