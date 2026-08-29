import { useRef, useState, useCallback, useEffect } from 'react'
import { UrlBar } from './components/UrlBar'
import { Player, PlayerHandle } from './components/Player'
import { Controls } from './components/Controls'
import { ClipList } from './components/ClipList'
import { SettingsModal } from './components/SettingsModal'
import { useFFmpeg } from './hooks/useFFmpeg'
import { clipVideo, ExportProgress } from './lib/clipExporter'
import { coversRange } from './lib/m3u8Parser'
import { formatTimeForFilename } from './lib/formatTime'
import { Clip } from './lib/types'

declare const __APP_VERSION__: string

declare function gtag(...args: unknown[]): void
const track = (event: string, params: Record<string, unknown>) => {
  if (typeof gtag !== 'undefined') gtag('event', event, params)
}

export default function App() {
  const [streamUrl, setStreamUrl] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [pendingMarks, setPendingMarks] = useState<{ in: number | null; out: number | null }>({ in: null, out: null })
  const [pendingName, setPendingName] = useState('')
  const [clips, setClips] = useState<Clip[]>([])
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [usingProxy, setUsingProxy] = useState(false)
  // Raw per-browser override only — empty unless the user has explicitly set one.
  const [proxyOverride, setProxyOverride] = useState<string>(
    () => localStorage.getItem('livecut-proxy') ?? ''
  )
  const proxyUrl = proxyOverride || (import.meta.env.VITE_PROXY_URL ?? '')
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    if (proxyOverride) {
      console.log(`[LiveCut] Proxy URL: ${proxyOverride} (source: localStorage override)`)
    } else if (import.meta.env.VITE_PROXY_URL) {
      console.log(`[LiveCut] Proxy URL: ${import.meta.env.VITE_PROXY_URL} (source: VITE_PROXY_URL build var)`)
    } else {
      console.log('[LiveCut] Proxy URL: none configured')
    }
  }, [proxyOverride])

  const handleSaveProxyUrl = useCallback((url: string) => {
    setProxyOverride(url)
    if (url) {
      localStorage.setItem('livecut-proxy', url)
    } else {
      localStorage.removeItem('livecut-proxy')
    }
  }, [])

  const applyProxy = useCallback((url: string) => {
    const p = proxyUrl.trim().replace(/\/$/, '')
    return p ? `${p}?url=${encodeURIComponent(url)}` : url
  }, [proxyUrl])


  const playerRef = useRef<PlayerHandle>(null)
  const { ffmpegRef, loading: ffmpegLoading, load: loadFFmpeg } = useFFmpeg()

  // Keyboard shortcuts: I = mark in, O = mark out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!streamUrl || e.target instanceof HTMLInputElement) return
      if (e.key === 'i' || e.key === 'I') handleMarkIn()
      if (e.key === 'o' || e.key === 'O') handleMarkOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const handleLoad = useCallback(async (url: string) => {
    setStreamError(null)
    setUsingProxy(false)
    setPendingMarks({ in: null, out: null })
    setPendingName('')
    setClips([])
    setExportingId(null)

    // Try direct first; fall back to proxy only if it fails
    let finalUrl = url
    let directFailed = false

    try {
      const res = await fetch(url)
      if (!res.ok) directFailed = true
    } catch {
      directFailed = true
    }

    if (directFailed) {
      console.log(`[LiveCut] Direct fetch failed for ${url}, falling back to proxy`)
      const proxy = proxyUrl.trim()
      if (proxy) {
        finalUrl = applyProxy(url)
        console.log(`[LiveCut] Using proxy: ${proxy} -> ${finalUrl}`)
        // Verify proxy also works
        try {
          const res = await fetch(finalUrl)
          if (!res.ok) {
            console.log(`[LiveCut] Proxy fetch failed (${res.status}): ${finalUrl}`)
            setStreamError(`Failed to fetch playlist (${res.status}) — even via proxy.`)
          } else {
            console.log(`[LiveCut] Proxy fetch succeeded: ${finalUrl}`)
            setUsingProxy(true)
          }
        } catch (err) {
          console.log(`[LiveCut] Proxy unreachable: ${finalUrl}`, err)
          setStreamError('Failed to fetch playlist — proxy unreachable.')
        }
      } else {
        console.log('[LiveCut] No proxy configured, cannot fall back')
        setStreamError(
          'Failed to fetch playlist (CORS). ' +
          'The stream URL must allow cross-origin access, or set a proxy URL below.'
        )
      }
    }

    setStreamUrl(finalUrl)
    track('stream_loaded', { stream_url: url, via_proxy: finalUrl !== url })
  }, [applyProxy, proxyUrl])

  const handleMarkIn = useCallback(() => {
    const t = playerRef.current?.getCurrentTime() ?? 0
    setPendingMarks((m) => ({ ...m, in: t }))
  }, [])

  const handleMarkOut = useCallback(() => {
    const t = playerRef.current?.getCurrentTime() ?? 0
    setPendingMarks((m) => ({ ...m, out: t }))
  }, [])

  const handleSeekTo = useCallback((time: number) => {
    playerRef.current?.seekTo(time)
  }, [])

  const handlePause = useCallback(() => {
    playerRef.current?.pause()
  }, [])

  const handlePreview = useCallback(() => {
    if (pendingMarks.in !== null && pendingMarks.out !== null) {
      playerRef.current?.playSegment(pendingMarks.in, pendingMarks.out)
    }
  }, [pendingMarks.in, pendingMarks.out])

  const handleQuickClip = useCallback((seconds: number) => {
    const t = playerRef.current?.getCurrentTime() ?? 0
    setPendingMarks({ in: Math.max(0, t - seconds), out: t })
  }, [])

  const handleLive = useCallback(() => {
    playerRef.current?.seekToLiveEdge()
  }, [])

  const handleAdjustIn = useCallback((delta: number) => {
    setPendingMarks((m) => ({ ...m, in: Math.max(0, (m.in ?? 0) + delta) }))
  }, [])

  const handleAdjustOut = useCallback((delta: number) => {
    setPendingMarks((m) => ({ ...m, out: Math.max(0, (m.out ?? 0) + delta) }))
  }, [])

  const MAX_CLIP_DURATION = 240 // 4 minutes

  const pendingDuration =
    pendingMarks.in !== null && pendingMarks.out !== null
      ? pendingMarks.out - pendingMarks.in
      : 0

  const canAddClip =
    pendingMarks.in !== null &&
    pendingMarks.out !== null &&
    pendingMarks.out > pendingMarks.in &&
    pendingDuration <= MAX_CLIP_DURATION

  const handleAddClip = useCallback(() => {
    if (!canAddClip || pendingMarks.in === null || pendingMarks.out === null) return
    const newClip: Clip = {
      id: crypto.randomUUID(),
      name: pendingName.trim() || `Clip ${clips.length + 1}`,
      in: pendingMarks.in,
      out: pendingMarks.out,
      exportStatus: 'idle',
      exportProgress: 0,
      exportError: null,
    }
    setClips((prev) => [...prev, newClip])
    setPendingMarks({ in: null, out: null })
    setPendingName('')
    track('clip_added', { duration_seconds: Math.round(pendingMarks.out! - pendingMarks.in!) })
  }, [canAddClip, pendingMarks, pendingName, clips.length])

  const handleDeleteClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleRenameClip = useCallback((id: string, name: string) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)))
  }, [])

  const handleExportClip = useCallback(async (id: string) => {
    const clip = clips.find((c) => c.id === id)
    if (!clip || exportingId) return

    const updateClip = (patch: Partial<Clip>) =>
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))

    let currentFfmpeg = ffmpegRef.current
    if (!currentFfmpeg) {
      updateClip({ exportStatus: 'loading-ffmpeg', exportProgress: 0, exportError: null })
      try {
        currentFfmpeg = await loadFFmpeg()
      } catch (err) {
        updateClip({ exportStatus: 'error', exportError: err instanceof Error ? err.message : String(err) })
        return
      }
    }

    setExportingId(id)
    updateClip({ exportStatus: 'exporting', exportProgress: 0, exportError: null })

    try {
      const onProgress = (p: ExportProgress) =>
        updateClip({ exportProgress: p.percent })

      // Prefer HLS.js's already-loaded fragments (avoids re-fetching possibly
      // expired segment URLs), but only if its sliding window still covers the
      // marked range — otherwise re-parse the playlist fresh.
      const fragments = playerRef.current?.getFragments()
      const fragmentsCover =
        !!fragments &&
        coversRange(fragments.video, clip.in, clip.out) &&
        (!fragments.audio || coversRange(fragments.audio, clip.in, clip.out))
      const source = fragmentsCover ? fragments! : streamUrl
      const blob = await clipVideo(source, clip.in, clip.out, currentFfmpeg, onProgress)

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clip.name.replace(/[^a-z0-9_\-]/gi, '_')}_${formatTimeForFilename(clip.in)}.mp4`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      updateClip({ exportStatus: 'done', exportProgress: 100 })
      track('clip_exported', {
        stream_url: urlInput,
        duration_seconds: Math.round(clip.out - clip.in),
        via_proxy: usingProxy,
      })
    } catch (err) {
      updateClip({ exportStatus: 'error', exportError: err instanceof Error ? err.message : String(err) })
    } finally {
      setExportingId(null)
    }
  }, [clips, exportingId, ffmpegRef, loadFFmpeg, streamUrl])

  const isPlayerVisible = !!streamUrl

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">LiveCut</h1>
        <span className="app-subtitle">HLS stream clipper</span>
        <span className="app-version">v{__APP_VERSION__}</span>
        {usingProxy && <span className="proxy-badge">via proxy</span>}
        <button
          type="button"
          className="settings-trigger"
          onClick={() => setShowSettings(true)}
          title="Advanced settings"
          aria-label="Advanced settings"
        >
          ⚙
        </button>
      </header>

      {showSettings && (
        <SettingsModal
          proxyUrl={proxyOverride}
          onSave={handleSaveProxyUrl}
          onClose={() => setShowSettings(false)}
        />
      )}

      <main className="app-main">
        {/* ── Left: video ── */}
        <div className="video-column">
          {isPlayerVisible ? (
            <Player ref={playerRef} src={streamUrl} onError={setStreamError} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">▶</div>
              <p>Paste an .m3u8 URL to get started</p>
              <p className="empty-hint">
                Try:{' '}
                <code
                  className="sample-url"
                  onClick={() => setUrlInput('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')}
                  title="Click to use this URL"
                >
                  https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
                </code>
              </p>
            </div>
          )}
          {streamError && (
            <div className="stream-error-overlay">
              <div className="stream-error-box">
                {streamError}
                <button className="stream-error-dismiss" onClick={() => setStreamError(null)}>×</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: sidebar ── */}
        <aside className="sidebar">
          <UrlBar onLoad={handleLoad} loading={false} value={urlInput} onChange={setUrlInput} />


          {isPlayerVisible && (
            <>
              <Controls
                marks={pendingMarks}
                onMarkIn={handleMarkIn}
                onMarkOut={handleMarkOut}
                onClearIn={() => setPendingMarks((m) => ({ ...m, in: null }))}
                onClearOut={() => setPendingMarks((m) => ({ ...m, out: null }))}
                onSeekTo={handleSeekTo}
                onPause={handlePause}
                onQuickClip={handleQuickClip}
                onLive={handleLive}
                onPreview={handlePreview}
                onAdjustIn={handleAdjustIn}
                onAdjustOut={handleAdjustOut}
                maxDuration={MAX_CLIP_DURATION}
                clipName={pendingName}
                onClipNameChange={setPendingName}
                onAddClip={handleAddClip}
                canAddClip={canAddClip}
              />

              {clips.length > 0 && (
                <ClipList
                  clips={clips}
                  exportingId={exportingId}
                  ffmpegLoading={ffmpegLoading && exportingId !== null}
                  onExport={handleExportClip}
                  onDelete={handleDeleteClip}
                  onRename={handleRenameClip}
                  onPreview={(id) => {
                    const clip = clips.find((c) => c.id === id)
                    if (clip) playerRef.current?.playSegment(clip.in, clip.out)
                  }}
                />
              )}
            </>
          )}

          <div className="sidebar-footer">
            Use <kbd>I</kbd> / <kbd>O</kbd> to mark in/out while playing.
          </div>
        </aside>
      </main>
    </div>
  )
}
