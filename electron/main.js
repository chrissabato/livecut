'use strict'

const { app, BrowserWindow, session, shell, dialog } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')

// Windows (ARM64 especially) hits Chromium GPU-process crashes that black out
// the window a few seconds after load. Fully disable the GPU path there — the
// perf hit is minor for a mostly-web-view app. LIVECUT_GPU=1 forces it back on;
// LIVECUT_NO_GPU=1 forces it off anywhere.
const forceNoGpu = process.env.LIVECUT_NO_GPU === '1'
const forceGpu = process.env.LIVECUT_GPU === '1'
const GPU_DISABLED = forceNoGpu || (process.platform === 'win32' && !forceGpu)
if (GPU_DISABLED) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// ── Load target ─────────────────────────────────────────────────────────────
const REMOTE_URL = 'https://chrissabato.github.io/livecut/'
const DEV_URL = 'http://localhost:5173/'
const IS_DEV = !!process.env.LIVECUT_DEV
const TARGET_URL = IS_DEV ? DEV_URL : REMOTE_URL

// Hosts that belong to the app itself — their requests/responses are left alone
// (aside from the main-frame COOP/COEP injection).
const APP_HOSTS = new Set(['chrissabato.github.io', 'localhost', '127.0.0.1'])

const isAppUrl = (url) =>
  url.startsWith(REMOTE_URL) || url.startsWith(DEV_URL) || url.startsWith('file://')

let mainWindow = null
let loadWatchdog = null

// ── Network-layer CORS / origin-blocking / 403 defeat ───────────────────────
// Only ONE onBeforeSendHeaders and ONE onHeadersReceived listener are allowed
// per session, so all logic lives in these two registrations. They sit below
// the renderer, so they transparently cover every fetch() call site and HLS.js
// worker/MSE fetches with no web-source change.
function installNetworkInterceptors () {
  const ses = session.defaultSession

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const requestHeaders = details.requestHeaders
    let host = ''
    try {
      host = new URL(details.url).hostname
    } catch {
      // non-http(s) scheme — leave untouched
    }

    if (host && !APP_HOSTS.has(host)) {
      // Strip the browser-supplied identifiers that origin-sensitive CDNs reject
      // with a 403. This is what actually fixes the 403 case (disabling
      // webSecurity would not).
      delete requestHeaders['Origin']
      delete requestHeaders['origin']
      delete requestHeaders['Referer']
      delete requestHeaders['referer']
      // Mitigation for a stream that *requires* a referer: instead of deleting,
      // set it to the target's own origin root:
      //   requestHeaders['Referer'] = new URL(details.url).origin + '/'
    }

    callback({ requestHeaders })
  })

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const responseHeaders = details.responseHeaders || {}
    let host = ''
    try {
      host = new URL(details.url).hostname
    } catch {
      /* ignore */
    }

    const isDocument =
      details.resourceType === 'mainFrame' || details.resourceType === 'subFrame'

    if (isDocument && host && APP_HOSTS.has(host)) {
      // Inject COOP/COEP straight onto the app document so crossOriginIsolated
      // is true on first load with no reload. GitHub Pages cannot send these.
      // coi-serviceworker.js still registers but early-returns when already
      // isolated, so there is no reload loop.
      setHeader(responseHeaders, 'Cross-Origin-Opener-Policy', 'same-origin')
      setHeader(responseHeaders, 'Cross-Origin-Embedder-Policy', 'credentialless')
    } else if (host && !APP_HOSTS.has(host)) {
      // Every cross-origin response: force permissive CORS. Under `credentialless`
      // these requests carry no cookies, so `*` with no credentials is exactly
      // what they expect.
      deleteHeader(responseHeaders, 'access-control-allow-origin')
      deleteHeader(responseHeaders, 'access-control-allow-credentials')
      setHeader(responseHeaders, 'Access-Control-Allow-Origin', '*')
      setHeader(responseHeaders, 'Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
      setHeader(responseHeaders, 'Access-Control-Allow-Headers', '*')
    }

    callback({ responseHeaders })
  })
}

// responseHeaders keys are case-preserving; match case-insensitively when
// replacing so we don't end up with duplicate variants.
function deleteHeader (headers, lowerName) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) delete headers[key]
  }
}
function setHeader (headers, name, value) {
  deleteHeader(headers, name.toLowerCase())
  headers[name] = [value]
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0e0e',
    title: 'LiveCut',
    autoHideMenuBar: process.platform === 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: ['--livecut-shell-version=' + app.getVersion()],
    },
  })

  const wc = mainWindow.webContents

  // External links / navigation hardening
  wc.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  // Local error screen on load failure — no bundled app fallback.
  wc.on('did-start-loading', armWatchdog)
  wc.on('did-finish-load', clearWatchdog)
  wc.on('did-finish-load', maybeCheckForUpdate)
  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* ERR_ABORTED */) {
      showErrorScreen(`network error ${code} (${desc})`)
    }
  })

  // Renderer crash: try exactly ONE reload for the whole process life, then sit
  // on the error page. Never loop — a persistent GPU/compositor fault would
  // otherwise flip between a black window and the error screen forever.
  wc.on('render-process-gone', (_e, details) => {
    logCrash('render-process-gone', details)
    if (details.reason === 'clean-exit') return
    if (reloadedAfterCrash) {
      showErrorScreen(`renderer ${details.reason}`)
      return
    }
    reloadedAfterCrash = true
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(TARGET_URL)
    }, 1000)
  })
  wc.on('unresponsive', () => logCrash('unresponsive', {}))

  if (IS_DEV) wc.openDevTools({ mode: 'detach' })

  mainWindow.loadURL(TARGET_URL)
}

function armWatchdog () {
  clearWatchdog()
  loadWatchdog = setTimeout(() => showErrorScreen('timed out reaching the site'), 15000)
}
function clearWatchdog () {
  if (loadWatchdog) {
    clearTimeout(loadWatchdog)
    loadWatchdog = null
  }
}
let reloadedAfterCrash = false
function showErrorScreen (reason) {
  clearWatchdog()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, 'error.html'), {
      search: reason ? 'reason=' + encodeURIComponent(reason) : undefined,
    })
  }
}

// ── Crash logging ────────────────────────────────────────────────────────
// crash.log lives in userData: %APPDATA%\LiveCut on Windows,
// ~/Library/Application Support/LiveCut on macOS.
function logCrash (kind, details) {
  const line = `${new Date().toISOString()}  ${kind}  ${JSON.stringify(details)}\n`
  console.error('[LiveCut]', line.trim())
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), line)
  } catch { /* best effort */ }
}

// ── Optional, non-blocking update nudge ────────────────────────────────────
// The shell loads remote content, so the UI/export/parser all update via the
// normal Pages deploy. This only nags when a newer *shell* (Chromium patch,
// new signing, etc.) has been published as a `desktop-v*` GitHub release.
let updateChecked = false
function maybeCheckForUpdate () {
  if (updateChecked || IS_DEV) return
  updateChecked = true

  const req = https.get(
    {
      host: 'api.github.com',
      path: '/repos/chrissabato/livecut/releases',
      headers: { 'User-Agent': 'LiveCut-Desktop', Accept: 'application/vnd.github+json' },
      timeout: 8000,
    },
    (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const releases = JSON.parse(body)
          const latest = releases
            .map((r) => r.tag_name)
            .filter((t) => typeof t === 'string' && t.startsWith('desktop-v'))
            .map((t) => t.slice('desktop-v'.length))
            .sort(compareSemver)
            .pop()
          if (latest && compareSemver(latest, app.getVersion()) > 0) {
            promptUpdate(latest)
          }
        } catch {
          /* ignore malformed responses */
        }
      })
    }
  )
  req.on('timeout', () => req.destroy())
  req.on('error', () => {})
}

function compareSemver (a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

function promptUpdate (version) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Get the update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'LiveCut desktop update',
      message: `LiveCut desktop v${version} is available.`,
      detail:
        `You're running v${app.getVersion()}. The new build picks up the latest ` +
        `Chromium/Electron. The app itself keeps updating automatically.`,
    })
    .then(({ response }) => {
      if (response === 0) {
        shell.openExternal('https://github.com/chrissabato/livecut/releases')
      }
    })
}

// ── App lifecycle ──────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // GPU / utility subprocess crashes — log only. With the GPU path disabled on
  // Windows there is nothing useful to do here but record it; reloading just
  // re-triggers the same fault.
  app.on('child-process-gone', (_e, details) => logCrash('child-process-gone', details))

  app.whenReady().then(() => {
    logCrash('startup', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      gpuDisabled: GPU_DISABLED,
      target: TARGET_URL,
    })
    installNetworkInterceptors()
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
