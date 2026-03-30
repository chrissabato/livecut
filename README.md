# LiveCut

Clip sections from HLS (`.m3u8`) streams and export them as MP4 — entirely in your browser. No uploads, no server, no installs.

**[Try it → chrissabato.github.io/livecut](https://chrissabato.github.io/livecut/)**

---

## How it works

1. Paste an `.m3u8` stream URL and click **Load** (or click the sample URL to prefill it)
2. The video starts playing automatically, muted
3. Use **Mark In** / **Mark Out** while the video plays (or press **I** / **O**) — the video pauses at the marked point
4. Fine-tune the marks with the nudge buttons (`−1s` `−0.1s` `+0.1s` `+1s`) — the video seeks and pauses at each adjusted position
5. Click **Preview** to play through the selected range and confirm it looks right
6. Give the clip a name and click **Add**
7. Repeat for as many clips as you need
8. Hit **Export** on any saved clip to download it as MP4

Exports are downloaded directly to your machine. Nothing leaves your browser.

---

## Features

- **Quick clip buttons** — `-3s`, `-5s`, `-10s` set the in/out points instantly based on the current playhead
- **Live button** — jumps to the live edge of the stream (5 s behind) for easy live clipping
- **Clip preview** — preview pending marks or any saved clip before exporting
- **Multi-clip workflow** — mark and queue multiple named clips before exporting
- **Inline rename** — click any clip name in the list to edit it
- **Per-clip export** — each clip has its own export button and progress bar
- **Frame-accurate nudging** — adjust in/out points in 0.1 s or 1 s steps with instant seek
- **4-minute clip limit** — warns before you queue a clip that could exhaust browser memory
- **Keyboard shortcuts** — `I` to mark in, `O` to mark out while playing
- **No re-encoding** — uses stream copy (`-c copy`) so exports are fast and lossless
- **Automatic CORS proxy fallback** — tries the stream directly first; only routes through a proxy if needed
- **Early error detection** — CORS/403 errors are shown immediately on load, not at export time

---

## CORS requirement

The stream URL must be publicly accessible with `Access-Control-Allow-Origin: *` headers. Streams behind authentication or without CORS support will not work directly, but the built-in proxy fallback handles most cases automatically.

### How the proxy works

LiveCut tries every stream URL directly first. If that fails (CORS or 403), it automatically retries through a proxy. Only the playlist fetch goes through the proxy — video segments are fetched directly from the CDN, so proxy bandwidth usage is minimal.

### Workarounds for blocked streams

**Local CORS proxy** — strips origin/referer headers that some CDNs block:
```bash
npx local-cors-proxy --proxyUrl https://your-stream-host.com --port 8010
```
Then paste `http://localhost:8010/your-stream.m3u8` into LiveCut.

**Browser extension** — extensions like "CORS Unblock" inject permissive response headers. Works for origin-based blocks; does not help with authentication-based 403s.

---

## Technical notes

### How exporting works
1. Segment URLs and timing are read directly from HLS.js's already-parsed playlist — no re-fetch of the `.m3u8` URL, so time-limited signed URLs don't expire between load and export
2. Only the segments that overlap the selected clip range are downloaded
3. [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) concatenates the segments and trims to the exact in/out points
4. The result is downloaded as an `.mp4` file

### SharedArrayBuffer / cross-origin isolation
FFmpeg.wasm requires `SharedArrayBuffer`, which requires cross-origin isolation (`crossOriginIsolated = true`). A service worker (`coi-serviceworker.js`) injects the necessary `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers. On first load the page reloads once to activate — this is expected.

### Limitations
- Clips are processed in memory; the 4-minute limit helps avoid hitting browser memory limits at typical bitrates
- Only one clip exports at a time
- Segment URLs must still be valid at export time (the `.m3u8` URL expiry is no longer an issue, but individual segment URLs can also be time-limited on some streams)

---

## Running locally

```bash
npm install
npm run dev
```

Requires Node 18+. The dev server sets the required COOP/COEP headers automatically.

For local development with a proxy, create a `.env.local` file (not committed):
```
VITE_PROXY_URL=https://your-proxy-url.example.com
```

---

## Deploying

Push to `main` — GitHub Actions builds and deploys to GitHub Pages automatically, and bumps the patch version on each deploy.

Settings → Pages → Source must be set to **GitHub Actions** (one-time setup).

### GitHub Actions variables

The following repository variables must be set under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Description |
|---|---|
| `PROXY_URL` | CORS proxy URL (e.g. `https://proxy.example.com`) |
| `GA_MEASUREMENT_ID` | Google Analytics 4 measurement ID (e.g. `G-XXXXXXXXXX`) |

These are injected at build time and do not appear in the source code.

---

## Analytics

Usage is tracked via Google Analytics 4. The following custom events are recorded:

| Event | Parameters |
|---|---|
| `stream_loaded` | `stream_url`, `via_proxy` |
| `clip_added` | `duration_seconds` |
| `clip_exported` | `stream_url`, `duration_seconds`, `via_proxy` |

---

## Stack

| | |
|---|---|
| Playback | [HLS.js](https://github.com/video-dev/hls.js) |
| Video processing | [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) 0.12 |
| UI | React 18 + Vite |
| Hosting | GitHub Pages |
