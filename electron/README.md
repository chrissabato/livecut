# LiveCut desktop shell

A thin [Electron](https://www.electronjs.org/) wrapper around the deployed
LiveCut site (`https://chrissabato.github.io/livecut/`). It exists for one
reason: **defeat CORS / origin-blocking / 403 at the network layer** so streams
that fail in a browser work on the desktop.

The shell loads the *live* site, so almost every change — UI, export logic,
parser, even the "download the desktop app" call-to-action — ships through the
normal GitHub Pages deploy with **no desktop re-download**. You only cut a new
desktop release when `electron/**` itself changes (or to pick up a Chromium
security patch via a newer Electron).

## How it works

- `main.js` creates one `BrowserWindow` with secure `webPreferences`
  (`contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity: true`)
  and `loadURL`s the remote site. No bundled copy of the app — if the site is
  unreachable it shows `error.html` with a Retry button.
- A single `onBeforeSendHeaders` + single `onHeadersReceived` pair on
  `session.defaultSession`:
  - strips `Origin` / `Referer` from cross-origin requests (fixes the 403 case),
  - forces `Access-Control-Allow-Origin: *` on cross-origin responses (fixes CORS),
  - injects `COOP: same-origin` + `COEP: credentialless` onto the app document so
    `crossOriginIsolated` (needed by FFmpeg.wasm) is true on first load with no
    reload.
- `preload.js` exposes `window.livecut = { isDesktop, version, platform }`. Every
  web-app branch keyed off it is a no-op in a plain browser.

## Non-goals (v1)

- **DRM / Widevine** — no CDM in stock Electron.
- **Auth-cookie / bearer streams** — `credentialless` drops cookies; there is no
  sign-in UI.
- **Fully-offline export** — FFmpeg core still loads from jsDelivr/unpkg.

## Develop

```bash
npm install            # in this electron/ directory
npm run dev            # starts Vite on :5173 + Electron pointed at localhost
```

`npm run dev` uses `concurrently` + `wait-on`; it sets `LIVECUT_DEV=1`, which
makes `main.js` load `http://localhost:5173/` and open detached DevTools.

Run against the **deployed** site instead:

```bash
npm start
```

## Build installers

```bash
npm run build          # current OS, per electron-builder.yml, --publish never
npm run build:mac      # dmg + zip, x64 + arm64
npm run build:win      # nsis, x64 + arm64
```

Output lands in `electron/dist/`. Local unsigned builds work fine for testing;
distributable macOS builds need the signing secrets below.

## Version

`electron/package.json` `version` is **hand-bumped, and only when the shell
changes**. It is what `app.getVersion()` and electron-builder read, and it names
the `desktop-v<version>` GitHub release. It is deliberately decoupled from the
root `package.json` `vX.Y.Z` that `deploy.yml` bumps on every push.

**When you bump it and cut a new `desktop-v*` release, also update the hard
download links that point at the previous one:**

- `DESKTOP_RELEASE_TAG` in `src/App.tsx` (the in-app "download it here" link)
- the download table in the root `README.md` "Desktop app" section

(The asset filenames carry the version — `LiveCut-<version>-<arch>.<ext>` — so
the URLs change every release. A moving `desktop-latest` release would remove
this manual step; not set up yet.)

## Release (CI)

`.github/workflows/desktop.yml` runs a macOS + Windows matrix and publishes a
`desktop-v<version>` release. It triggers on:

- `workflow_dispatch` (also covers "rebuild for a Chromium patch"), or
- a push to `main` touching `electron/**` or the workflow file.

It does **not** trigger on the per-push `chore: bump version` commits (they only
touch root `package.json`).

### Signing secrets (GitHub → Settings → Secrets and variables → Actions)

macOS builds are signed with a Developer ID Application certificate and
notarized. Provide:

| Secret | Value |
|---|---|
| `CSC_LINK` | base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

Windows ships **unsigned** in v1. SmartScreen shows "Windows protected your PC" —
click **More info → Run anyway**. A code-signing cert is a later add.
