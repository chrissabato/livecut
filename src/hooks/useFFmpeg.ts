import { useRef, useState, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

const CORE_VERSION = '0.12.6'

// Try jsdelivr first (more reliable in some regions), fall back to unpkg
const CDN_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
]

export interface FFmpegHook {
  ffmpegRef: React.RefObject<FFmpeg | null>
  loaded: boolean
  loading: boolean
  load: () => Promise<FFmpeg>
}

/**
 * Manages a singleton FFmpeg.wasm instance.
 * Loads the core lazily on first call to load().
 * Uses toBlobURL to convert CDN resources to same-origin blob URLs
 * (required to satisfy Cross-Origin-Embedder-Policy).
 * Throws on failure so callers get the real error message.
 */
export function useFFmpeg(): FFmpegHook {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current && loaded) return ffmpegRef.current
    if (loading) throw new Error('FFmpeg is already loading')

    if (!self.crossOriginIsolated) {
      console.warn(
        '[FFmpeg] crossOriginIsolated is false — the service worker may not be active. ' +
        'Try a hard refresh (Ctrl+Shift+R). FFmpeg may still work on some browsers.'
      )
    }

    setLoading(true)

    let lastError: unknown
    for (const base of CDN_BASES) {
      try {
        console.log(`[FFmpeg] Loading core from ${base}…`)
        const ffmpeg = new FFmpeg()
        ffmpegRef.current = ffmpeg

        ffmpeg.on('log', ({ message }) => console.debug('[FFmpeg]', message))

        await ffmpeg.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        })

        console.log('[FFmpeg] Loaded successfully')
        setLoaded(true)
        setLoading(false)
        return ffmpeg
      } catch (err) {
        console.error(`[FFmpeg] Failed to load from ${base}:`, err)
        lastError = err
        ffmpegRef.current = null
      }
    }

    setLoading(false)
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError))
  }, [loaded, loading])

  return { ffmpegRef, loaded, loading, load }
}
