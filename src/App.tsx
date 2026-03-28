import { useRef, useState, useCallback, useEffect } from 'react'
import { UrlBar } from './components/UrlBar'
import { Player, PlayerHandle } from './components/Player'
import { Controls } from './components/Controls'
import { StatusBar } from './components/StatusBar'
import { useFFmpeg } from './hooks/useFFmpeg'
import { clipVideo, ExportProgress } from './lib/clipExporter'
import { formatTimeForFilename } from './lib/formatTime'

declare const __APP_VERSION__: string

interface Marks {
  in: number | null
  out: number | null
}

type ExportStatus = 'idle' | 'loading-ffmpeg' | 'exporting' | 'done' | 'error'

interface ExportState {
  status: ExportStatus
  stage: string
  percent: number
  error: string | null
}

const INITIAL_EXPORT: ExportState = { status: 'idle', stage: '', percent: 0, error: null }

export default function App() {
  const [streamUrl, setStreamUrl] = useState<string>('')
  const [marks, setMarks] = useState<Marks>({ in: null, out: null })
  const [exportState, setExportState] = useState<ExportState>(INITIAL_EXPORT)

  const playerRef = useRef<PlayerHandle>(null)
  const { ffmpegRef, loaded: ffmpegLoaded, loading: ffmpegLoading, load: loadFFmpeg } = useFFmpeg()

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

  const handleLoad = useCallback((url: string) => {
    setStreamUrl(url)
    setMarks({ in: null, out: null })
    setExportState(INITIAL_EXPORT)
  }, [])

  const handleMarkIn = useCallback(() => {
    const t = playerRef.current?.getCurrentTime() ?? 0
    setMarks((m) => ({ ...m, in: t }))
  }, [])

  const handleMarkOut = useCallback(() => {
    const t = playerRef.current?.getCurrentTime() ?? 0
    setMarks((m) => ({ ...m, out: t }))
  }, [])

  const canExport =
    marks.in !== null &&
    marks.out !== null &&
    marks.out > marks.in &&
    exportState.status !== 'exporting' &&
    exportState.status !== 'loading-ffmpeg'

  const handleExport = useCallback(async () => {
    if (!canExport || marks.in === null || marks.out === null) return

    let currentFfmpeg = ffmpegRef.current
    if (!currentFfmpeg) {
      setExportState({ status: 'loading-ffmpeg', stage: 'Loading FFmpeg…', percent: 0, error: null })
      currentFfmpeg = await loadFFmpeg()
    }

    setExportState({ status: 'exporting', stage: 'Starting…', percent: 0, error: null })

    try {
      const onProgress = (p: ExportProgress) => {
        setExportState({ status: 'exporting', stage: p.stage, percent: p.percent, error: null })
      }

      const blob = await clipVideo(streamUrl, marks.in, marks.out, currentFfmpeg, onProgress)

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `clip_${formatTimeForFilename(marks.in)}_${formatTimeForFilename(marks.out)}.mp4`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      setExportState({ status: 'done', stage: 'Done!', percent: 100, error: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setExportState({ status: 'error', stage: '', percent: 0, error: msg })
    }
  }, [canExport, marks, ffmpegLoaded, ffmpegRef, loadFFmpeg, streamUrl])

  const isPlayerVisible = !!streamUrl
  const isExporting = exportState.status === 'exporting' || exportState.status === 'loading-ffmpeg'

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">LiveCut</h1>
        <span className="app-subtitle">HLS stream clipper</span>
        <span className="app-version">v{__APP_VERSION__}</span>
      </header>

      <main className="app-main">
        {/* ── Left: video ── */}
        <div className="video-column">
          {isPlayerVisible ? (
            <Player ref={playerRef} src={streamUrl} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">▶</div>
              <p>Paste an .m3u8 URL to get started</p>
              <p className="empty-hint">
                Try: <code>https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8</code>
              </p>
            </div>
          )}
        </div>

        {/* ── Right: controls sidebar ── */}
        <aside className="sidebar">
          <UrlBar onLoad={handleLoad} loading={false} />

          <p className="cors-note">
            Stream must allow cross-origin access (CORS).
          </p>

          {isPlayerVisible && (
            <>
              <Controls
                marks={marks}
                onMarkIn={handleMarkIn}
                onMarkOut={handleMarkOut}
                onClearIn={() => setMarks((m) => ({ ...m, in: null }))}
                onClearOut={() => setMarks((m) => ({ ...m, out: null }))}
                disabled={false}
              />

              <div className="export-row">
                <button
                  className="btn btn-export"
                  onClick={handleExport}
                  disabled={!canExport}
                >
                  {isExporting ? 'Exporting…' : ffmpegLoading ? 'Loading FFmpeg…' : 'Export Clip'}
                </button>
                {exportState.status === 'done' && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setExportState(INITIAL_EXPORT)}
                  >
                    Export Another
                  </button>
                )}
              </div>

              <StatusBar
                status={exportState.status}
                stage={exportState.stage}
                percent={exportState.percent}
                error={exportState.error}
              />
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
