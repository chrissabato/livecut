import { useRef, useState, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'

const CORE_VERSION = '0.12.6'

// When @ffmpeg/ffmpeg is loaded from CDN (as configured in vite.config),
// its internal worker.js also resolves to CDN via import.meta.url.
// Using direct CDN URLs for coreURL/wasmURL means the CDN worker imports
// the core from the same CDN origin — no cross-origin blob complications.
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

export function useFFmpeg(): FFmpegHook {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current && loaded) return ffmpegRef.current
    if (loading) throw new Error('FFmpeg is already loading')

    if (!self.crossOriginIsolated) {
      console.warn(
        '[FFmpeg] crossOriginIsolated is false. ' +
        'The service worker may not have activated yet — try a hard refresh (Ctrl+Shift+R).'
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

        // classWorkerURL must be an absolute same-origin URL — cross-origin workers
        // are blocked in crossOriginIsolated contexts. This wrapper script imports
        // the CDN worker as a module (which IS allowed from a same-origin worker).
        const classWorkerURL = new URL('ffmpeg-worker.js', location.href).href

        await ffmpeg.load({
          classWorkerURL,
          coreURL: `${base}/ffmpeg-core.js`,
          wasmURL: `${base}/ffmpeg-core.wasm`,
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
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }, [loaded, loading])

  return { ffmpegRef, loaded, loading, load }
}
