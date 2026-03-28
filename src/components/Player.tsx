import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Hls from 'hls.js'

export interface PlayerHandle {
  getCurrentTime: () => number
  seekTo: (time: number) => void
}

interface Props {
  src: string
}

export const Player = forwardRef<PlayerHandle, Props>(({ src }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    seekTo: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = time
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
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          console.error('[HLS] Fatal error:', data)
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support
      video.src = src
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
