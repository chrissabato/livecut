# LiveCut

Clip sections from HLS (`.m3u8`) streams and export them as MP4 — entirely in your browser. No uploads, no server, no installs.

**[Try it → chrissabato.github.io/livecut](https://chrissabato.github.io/livecut/)**

---

## How it works

1. Paste an `.m3u8` stream URL and click **Load**
2. Use **Mark In** / **Mark Out** while the video plays (or press **I** / **O**)
3. Fine-tune the marks with the `−1s` `−0.1s` `+0.1s` `+1s` nudge buttons — the video seeks to each adjusted position instantly
4. Click the timecode to preview that exact frame
5. Give the clip a name and click **Add**
6. Repeat for as many clips as you need
7. Hit **Export** on any clip to download it as MP4

Exports are downloaded directly to your machine. Nothing leaves your browser.

---

## Features

- **Multi-clip workflow** — mark and queue multiple named clips before exporting
- **Inline rename** — click any clip name in the list to edit it
- **Per-clip export** — each clip has its own export button and progress bar
- **Frame-accurate nudging** — adjust in/out points in 0.1 s or 1 s steps with instant video preview
- **Keyboard shortcuts** — `I` to mark in, `O` to mark out while playing
- **No re-encoding** — uses stream copy (`-c copy`) so exports are fast and lossless

---

## Technical notes

### CORS requirement
The stream URL and its segments must be publicly accessible with `Access-Control-Allow-Origin: *` headers. Streams behind authentication or without CORS support will not work.

### How exporting works
1. The `.m3u8` playlist is fetched and parsed in the browser
2. Only the segments that overlap the selected clip range are downloaded
3. [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) concatenates the segments and trims to the exact in/out points
4. The result is downloaded as an `.mp4` file

### SharedArrayBuffer / cross-origin isolation
FFmpeg.wasm requires `SharedArrayBuffer`, which requires cross-origin isolation (`crossOriginIsolated = true`). A service worker (`coi-serviceworker.js`) injects the necessary `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers. On first load the page reloads once to activate — this is expected.

### Limitations
- Clips are processed in memory; keep clips under ~5 minutes at typical bitrates to avoid hitting browser memory limits
- Only one clip exports at a time
- Live stream clips must be exported while the segments are still available in the stream window

---

## Running locally

```bash
npm install
npm run dev
```

Requires Node 18+. The dev server sets the required COOP/COEP headers automatically.

## Deploying

Push to `main` — GitHub Actions builds and deploys to GitHub Pages automatically, and bumps the patch version on each deploy.

Settings → Pages → Source must be set to **GitHub Actions** (one-time setup).

---

## Stack

| | |
|---|---|
| Playback | [HLS.js](https://github.com/video-dev/hls.js) |
| Video processing | [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) 0.12 |
| UI | React 18 + Vite |
| Hosting | GitHub Pages |
