import { useRef, useState, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const CORE_VERSION = '0.12.6'
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`

export interface FFmpegHook {
  ffmpegRef: React.RefObject<FFmpeg | null>
  loaded: boolean
  loading: boolean
  loadError: string | null
  // Returns the FFmpeg instance on success, null on failure.
  // Safe to call in async contexts — avoids stale closure issues.
  load: () => Promise<FFmpeg | null>
}

/**
 * Manages a singleton FFmpeg.wasm instance.
 * Loads the core lazily on first call to load().
 * Uses toBlobURL to convert unpkg CDN resources to same-origin blob URLs
 * (required to satisfy Cross-Origin-Embedder-Policy).
 */
export function useFFmpeg(): FFmpegHook {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<FFmpeg | null> => {
    // Already loaded — return existing instance
    if (ffmpegRef.current && loaded) return ffmpegRef.current
    if (loading) return null

    setLoading(true)
    setLoadError(null)

    try {
      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg

      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      })

      setLoaded(true)
      return ffmpeg
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoadError(`Failed to load FFmpeg: ${msg}`)
      ffmpegRef.current = null
      return null
    } finally {
      setLoading(false)
    }
  }, [loaded, loading])

  return { ffmpegRef, loaded, loading, loadError, load }
}
