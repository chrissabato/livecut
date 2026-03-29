import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Hls from 'hls.js'

export interface PlayerHandle {
  getCurrentTime: () => number
  seekTo: (time: number) => void
  pause: () => void
  playSegment: (start: number, end: number) => void
  seekToLiveEdge: () => void
}

interface Props {
  src: string
  onError?: (message: string) => void
}

export const Player = forwardRef<PlayerHandle, Props>(({ src, onError }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    seekTo: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = time
    },
    pause: () => videoRef.current?.pause(),
    seekToLiveEdge: () => {
      const video = videoRef.current
      if (!video) return
      const hls = hlsRef.current
      let edge: number | null = null
      if (hls?.liveSyncPosition != null) {
        edge = hls.liveSyncPosition
      } else if (video.seekable.length > 0) {
        edge = video.seekable.end(video.seekable.length - 1)
      }
      if (edge != null) video.currentTime = Math.max(0, edge - 5)
    },
    playSegment: (start: number, end: number) => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = start
      video.play().catch(() => {})
      const onTimeUpdate = () => {
        if (video.currentTime >= end) {
          video.pause()
          video.removeEventListener('timeupdate', onTimeUpdate)
        }
      }
      video.addEventListener('timeupdate', onTimeUpdate)
    },
  }))

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    // Tear down any previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          console.error('[HLS] Fatal error:', data)
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            const code = (data.response as { code?: number } | undefined)?.code
            if (code === 403) {
              onError?.('Failed to fetch playlist (403). The stream URL must allow cross-origin access (CORS: Access-Control-Allow-Origin: *).')
            } else if (!code || code === 0) {
              onError?.('Failed to fetch playlist (CORS). The stream URL must allow cross-origin access (CORS: Access-Control-Allow-Origin: *).')
            } else {
              onError?.(`Failed to fetch playlist (HTTP ${code}).`)
            }
          }
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support
      video.src = src
      video.play().catch(() => {})
    } else {
      console.error('This browser does not support HLS playback.')
    }

    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [src])

  return (
    <div className="player-wrapper">
      <video
        ref={videoRef}
        className="player-video"
        controls
        playsInline
      />
    </div>
  )
})

Player.displayName = 'Player'
