# Screening Room · notes for AI coding agents

A static 3D video-portfolio template (three.js). Users customize it by editing **`reel.config.json`** only; keep it that way.

## When a user asks you to set up their site
1. Edit `reel.config.json`: `site` (name, tagline, description, contact, languages), `categories`, `videos`.
2. Put local videos/covers in `public/media/` and reference them relative to `public/` (e.g. `media/film.mp4`).
3. Run `npm run build` and fix any `✖ reel.config.json:` errors it prints. `npm run dev` serves `dist/` at http://localhost:5173.
4. Replace the demo media in `public/media/` (it belongs to the template author and is not MIT-licensed).

## Rules
- Only embed official platform players (see `scripts/sources.mjs`). Never add code that extracts or downloads platform video streams.
- Platform titles/covers are fetched at build time only and cached in `.cache/`; don't move these requests to the browser.
- All asset URLs must stay relative (sites are often served from a sub-path such as GitHub Pages `/<repo>/`).
- UI text lives in `src/i18n.js` (zh + en). Add both languages when you add a string.
- `dist/`, `.cache/` and `node_modules/` are build output; don't commit them.

## Map
- `scripts/build.mjs` — config → sources → covers/thumbnails → one HTML page per language → esbuild bundle.
- `scripts/sources.mjs` — link → { kind: video | embed | link, provider, embed URL }.
- `scripts/media.mjs` — ffprobe/ffmpeg helpers (optional), platform metadata, image sizes.
- `src/scene.js` — the cinema: projector model, volumetric beam + dust, screen, film layer (VideoTexture), camera flights.
- `scripts/record.mjs` — frame-by-frame promo recorder (Playwright clock + ffmpeg): `npm run record`.
- `src/app.js` — reel/strip navigation, play flows (mp4 projection, iframe overlay, link-out), controls, language switch, gestures.
