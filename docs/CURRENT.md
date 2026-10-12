# Current status

Updated: 2026-10-12

- v1: template extracted from the author's own site (video.oniontnd.com) and generalized.
- Features: any aspect ratio; local/remote mp4 projected as a VideoTexture on the 3D screen with custom controls; official embeds for YouTube / Bilibili / Vimeo / TikTok / Xinpianchang; Douyin and unknown sites as cover + link-out; optional covers (ffmpeg frame at build, or browser frame capture); zh/en with `/en/` page; GitHub Pages workflow; Cloudflare / Vercel / Netlify configs.
- Verified locally with Playwright (Chromium, Metal GPU): desktop 1280×800 and iPhone 13 emulation — browse, mp4 projection with sound, pause, back to booth, language switch, YouTube and Bilibili embeds, build without ffmpeg.
- Not verified: real iOS Safari / Android devices.

- 2026-10-12 published: public template repo https://github.com/onion0619/projector-reel (marked as template; topics set). GitHub Pages demo https://onion0619.github.io/projector-reel/ (en: /en/) deployed by `.github/workflows/pages.yml`; full flow re-verified against the live site.

Next: optional — bump GitHub Actions to Node 24-based majors when available (runner shows Node 20 deprecation warnings); migrate video.oniontnd.com onto this template.
