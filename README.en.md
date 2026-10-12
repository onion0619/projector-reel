# Screening Room

[中文](README.md) · **English**

Turn your video portfolio into a 3D cinema. The camera sits in the projection booth, looking past a vintage projector at the screen. Click the projector: the lamp strikes, the reels spin, a 3-2-1 leader rolls, and the camera flies down the beam to the screen, where your film plays.

[![Preview: the lamp strikes, films change, and after a click on the projector the camera flies down the beam to the screen where the film plays](docs/preview.webp)](docs/preview.mp4)

<sub>Click for the 1080p · 60 fps video (with sound)</sub>

**Live demo:** https://onion0619.github.io/screening-room/en/

- **mp4 files are projected for real**: the video is a texture on the 3D screen, the beam matches its aspect ratio, and the screen's glow tints the seats with the film's colors
- **Platform videos work too**: YouTube, Bilibili, Vimeo, TikTok and Xinpianchang via their official players; Douyin and other non-embeddable sites get a cover and a "watch on…" link
- **One file to edit**: `reel.config.json` holds your name, categories and video links. Covers are optional: grabbed from the mp4 or the platform
- **Bilingual**: one-tap Chinese / English toggle, plus an `/en/` page with English share cards for X
- **Phone-ready**: swipe to browse; resolution drops automatically on slow devices
- **Fully static**: the build is a folder you can host on GitHub Pages, Cloudflare, Vercel or Netlify

## Get started in three steps

1. Click **Use this template → Create a new repository**.
2. Edit `reel.config.json`, put your videos in `public/media/` (or paste platform links), and commit.
3. In **Settings → Pages → Source**, choose **GitHub Actions**. Every push now publishes to `https://<you>.github.io/<repo>/`.

## Configuration

```jsonc
{
  "site": {
    "name": { "zh": "李复冲", "en": "Li Fuchong" },  // any text can be a string or one per language
    "tagline": { "zh": "影像作品", "en": "Video Works" },
    "description": { "zh": "…", "en": "…" },        // search engines and share cards
    "contact": "you@example.com",                    // email or URL, optional
    "url": "",                                       // public URL; filled in automatically on GitHub Pages
    "languages": ["en"],                             // one or both of "zh", "en"
    "defaultLang": "en",                             // served at /, others at /<lang>/
    "shareImage": "media/cover.jpg"                  // share-card image, 1200×630 works best
  },
  "categories": [
    { "id": "ads", "name": "Commercials" }
  ],
  "videos": [
    {
      "id": "my-film",                               // optional, used in links: /#my-film
      "title": "My Film",                            // optional for platform videos
      "category": "ads",
      "src": "media/my-film.mp4",                    // see the table below
      "cover": "media/my-film.jpg",                  // optional
      "aspect": "9:16"                               // optional, detected for mp4
    }
  ]
}
```

Editors that support JSON Schema give you autocomplete and validation (`reel.schema.json`).

### What `src` accepts

| Source | Example | Playback | Notes |
| --- | --- | --- | --- |
| Local mp4 | `media/film.mp4` (under `public/`) | **Projected on the 3D screen** | Recommended. Without a cover, the frame at 1s is used |
| Remote mp4 | `https://…/film.mp4` | Projected on the screen | The host must allow CORS so the frames can be read |
| YouTube | `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…` | Official player | Title and cover fetched automatically; blocked in mainland China |
| Bilibili | `bilibili.com/video/BV…` | Official embed player | Title and cover fetched; the embed player streams at lower quality |
| Vimeo | `vimeo.com/…` | Official player | Title and cover fetched |
| TikTok | `tiktok.com/@…/video/…` | Official embed player | Title and cover fetched |
| Xinpianchang | `xinpianchang.com/a…` | Official player | Player parameters and cover fetched |
| Douyin | `douyin.com/video/…` | Cover + link out | No public embed; **add your own cover** |

**Different sources per language:** `"src": { "zh": "https://www.bilibili.com/video/BV…", "en": "https://youtu.be/…" }`

**About scraping:** the template only embeds each platform's official player and never extracts video files. Titles and covers are fetched once at build time through official endpoints (oEmbed and similar), cached in `.cache/` and stored with the site, so visitors never hit those APIs.

## Tips for mp4

- Videos only load when someone presses play, so they don't slow down the page. Compress them and move the index to the front so playback starts while downloading:

  ```bash
  ffmpeg -i in.mp4 -c:v libx264 -crf 23 -maxrate 5M -bufsize 10M -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k out.mp4
  ```

- Best for shorts, reels and promos. For long films, platform players adapt quality to the viewer's connection.
- File size limits: 100 MB on GitHub, 25 MB per file on Cloudflare. Host larger files on object storage (e.g. Cloudflare R2) with CORS enabled and use the full URL.

## Deploy

| Host | How |
| --- | --- |
| GitHub Pages | `.github/workflows/pages.yml` is included; follow the three steps above |
| Cloudflare | `npx wrangler login`, then `npm run deploy:cloudflare`; custom domain in `wrangler.jsonc` |
| Vercel / Netlify | Import the repo; `vercel.json` / `netlify.toml` are included (build `npm run build`, output `dist`) |

With ffmpeg installed, the build grabs covers and makes film-strip thumbnails. Without it the build still works, and covers are grabbed in the browser instead.

## Local development

```bash
npm install
npm run dev        # builds and serves http://localhost:5173
```

Run `npm run dev` again after changes. Try another config with `REEL_CONFIG=examples/mixed-sources.json npm run dev`.

### Record a promo clip of your cinema

```bash
npx playwright install chromium   # first time only
npm run build && npm run record
```

Renders `docs/preview.mp4` frame by frame (1920×1080, 60 fps, with the film's sound) plus `docs/preview.webp` for your README, ready to post. Vertical: `node scripts/record.mjs --size=1080x1920 --out=docs/preview-vertical.mp4`; more options at the top of `scripts/record.mjs`. Requires ffmpeg.

## FAQ

**No sound on my phone?** Some browsers block autoplay with sound; the film then starts muted with a "Tap for sound" button.

**No large image when sharing on X?** Set `site.url` (automatic on GitHub Pages) and use a 1200×630 `shareImage`.

**Devices without WebGL?** The page falls back to a flat mode: the cover as a backdrop and the video centered.

## License

Code is [MIT](LICENSE) licensed.

The demo videos and covers in `public/media/` are works by Li Fuchong (promos for the TongKe and FR live apps) and are **not** covered by the MIT license. Replace them with your own work.
