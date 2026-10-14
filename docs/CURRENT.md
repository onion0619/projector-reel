# Current status

Updated: 2026-10-12

- v1: template extracted from the author's own site (video.oniontnd.com) and generalized.
- Features: any aspect ratio; local/remote mp4 projected as a VideoTexture on the 3D screen with custom controls; official embeds for YouTube / Bilibili / Vimeo / TikTok / Xinpianchang; Douyin and unknown sites as cover + link-out; optional covers (ffmpeg frame at build, or browser frame capture); zh/en with `/en/` page; GitHub Pages workflow; Cloudflare / Vercel / Netlify configs.
- Verified locally with Playwright (Chromium, Metal GPU): desktop 1280×800 and iPhone 13 emulation — browse, mp4 projection with sound, pause, back to booth, language switch, YouTube and Bilibili embeds, build without ffmpeg.
- Not verified: real iOS Safari / Android devices.

- 2026-10-12 published: public template repo https://github.com/onion0619/projector-reel (marked as template; topics set). GitHub Pages demo https://onion0619.github.io/projector-reel/ (en: /en/) deployed by `.github/workflows/pages.yml`; full flow re-verified against the live site.

- 2026-10-13 renamed: projector-reel → screening-room (repo, Pages URL https://onion0619.github.io/screening-room/, local folder). Old Pages URL no longer serves; GitHub redirects the old repo URL.
- 2026-10-13 demo media: replaced the blurry real-time GIF/webm with a frame-by-frame recording (`scripts/record.mjs`, `npm run record`): docs/preview.mp4 1080p60 with film audio, docs/preview.webp for the README, new share.jpg. Films now project in true color (bloom off + direct render while rolling, no fog on screen/film layers).
- 2026-10-15 load speed: dropped RectAreaLight (its LTC tables were 241 KB of the bundle; screen glow is now a wide SpotLight); split the bundle (UI 16 KB loads first, three.js chunk 558 KB / 147 KB gzip lazy-loaded with modulepreload); first cover preloaded in <head> and shown as a blurred "preshow" until the 3D fades in; covers/thumbs built as WebP (cover 148→26 KB); neighbour prefetch deferred; intro ignite 700→250 ms, glide 3.2→2.6 s; play pressed before 3D is ready is queued. Measured (Chromium, throttled): screen cover visible 4G 1.27→0.94 s, 3G 4.25→1.88 s. Dev server gzips text like GitHub Pages. `performance.mark("sr:*")` timing marks stay in the code.

Next: optional — bump GitHub Actions to Node 24-based majors when available (runner shows Node 20 deprecation warnings); migrate video.oniontnd.com onto this template.
