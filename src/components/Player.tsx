import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Hls from 'hls.js'

export interface HlsFragment {
  uri: string
  startTime: number
  duration: number
  discontinuity?: boolean
  pdt?: number | null
  /**
   * Raw segment bytes captured while HLS.js was playing, when still held in the
   * in-memory buffer. Present -> export uses these directly and skips the
   * network entirely (immune to signed-URL expiry / segment CORS).
   */
  data?: Uint8Array
}

export interface HlsFragments {
  video: HlsFragment[]
  audio: HlsFragment[] | null
}

export interface PlayerHandle {
  getCurrentTime: () => number
  seekTo: (time: number) => void
  pause: () => void
  playSegment: (start: number, end: number) => void
  seekToLiveEdge: () => void
  getFragments: () => HlsFragments | null
}

interface Props {
  src: string
  onError?: (message: string) => void
}

interface AccumFragment {
  sn: number
  uri: string
  startTime: number
  duration: number
  cc: number
  pdt: number | null
  /** Raw segment bytes, once HLS.js has downloaded this fragment for playback. */
  data?: Uint8Array
}

// How much raw segment data to keep in memory for export. Live CDNs frequently
// hand out short-lived per-segment signed URLs, so re-fetching an evicted
// fragment 404s — capturing the bytes as they play is the only reliable way to
// clip anything that isn't right at the live edge. 400 MB covers several
// minutes at typical live bitrates; the 4-minute clip cap keeps a single export
// inside that.
const SEGMENT_BUFFER_CAP_BYTES = 400 * 1024 * 1024

export const Player = forwardRef<PlayerHandle, Props>(({ src, onError }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  // HLS.js only keeps the *current* live-manifest window in
  // `levels[].details.fragments`; segments scroll off as the playlist refreshes.
  // We accumulate every fragment seen this session (keyed by media sequence
  // number) — metadata from each playlist refresh, raw bytes from FRAG_LOADED —
  // so a clip marked a while ago can still be exported without re-fetching
  // (possibly expired) segment URLs.
  const videoAccumRef = useRef<Map<number, AccumFragment>>(new Map())
  const audioAccumRef = useRef<Map<number, AccumFragment>>(new Map())
  const bufferedBytesRef = useRef(0)

  const resetAccumulation = () => {
    videoAccumRef.current.clear()
    audioAccumRef.current.clear()
    bufferedBytesRef.current = 0
  }

  const ingestFragments = (
    map: Map<number, AccumFragment>,
    frags: readonly { sn: number | 'initSegment'; url: string; start: number; duration: number; cc: number; programDateTime?: number | null }[]
  ) => {
    for (const f of frags) {
      if (typeof f.sn !== 'number') continue
      const existing = map.get(f.sn)
      map.set(f.sn, {
        sn: f.sn,
        uri: f.url,
        startTime: f.start,
        duration: f.duration,
        cc: f.cc,
        pdt: f.programDateTime ?? null,
        data: existing?.data, // keep bytes already captured for this segment
      })
    }
  }

  // Store the raw bytes of a just-played fragment and evict oldest segments
  // (across both tracks) once the buffer exceeds its cap.
  const storeFragmentData = (track: 'video' | 'audio', sn: number, bytes: Uint8Array) => {
    const map = track === 'audio' ? audioAccumRef.current : videoAccumRef.current
    const rec = map.get(sn)
    if (rec) {
      if (!rec.data) bufferedBytesRef.current += bytes.byteLength
      rec.data = bytes
    } else {
      map.set(sn, {
        sn, uri: '', startTime: 0, duration: 0, cc: 0, pdt: null, data: bytes,
      })
      bufferedBytesRef.current += bytes.byteLength
    }

    while (bufferedBytesRef.current > SEGMENT_BUFFER_CAP_BYTES) {
      const oldestV = firstDataSn(videoAccumRef.current)
      const oldestA = firstDataSn(audioAccumRef.current)
      if (oldestV == null && oldestA == null) break
      const dropVideo =
        oldestA == null || (oldestV != null && oldestV <= oldestA)
      const dropMap = dropVideo ? videoAccumRef.current : audioAccumRef.current
      const dropSn = dropVideo ? oldestV! : oldestA!
      const dropRec = dropMap.get(dropSn)
      if (dropRec?.data) {
        bufferedBytesRef.current -= dropRec.data.byteLength
        dropRec.data = undefined
      }
    }
  }

  const firstDataSn = (map: Map<number, AccumFragment>): number | null => {
    let min: number | null = null
    for (const rec of map.values()) {
      if (rec.data && (min == null || rec.sn < min)) min = rec.sn
    }
    return min
  }

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    seekTo: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = time
    },
    pause: () => videoRef.current?.pause(),
    getFragments: () => {
      // Fold in whatever the current manifest holds right now, then read from the
      // session-wide accumulation so evicted-but-already-seen segments count.
      const hls = hlsRef.current
      if (hls) {
        const levelIndex = hls.currentLevel >= 0 ? hls.currentLevel : 0
        const curVideo = hls.levels[levelIndex]?.details?.fragments
        if (curVideo) ingestFragments(videoAccumRef.current, curVideo)
        const audioTrack = hls.audioTrack >= 0 ? hls.audioTracks[hls.audioTrack] : undefined
        const curAudio = audioTrack?.details?.fragments
        if (curAudio) ingestFragments(audioAccumRef.current, curAudio)
      }

      const toSorted = (map: Map<number, AccumFragment>): HlsFragment[] => {
        // Skip byte-only stubs that never got playlist metadata (shouldn't
        // normally happen — metadata is ingested before FRAG_LOADED fires).
        const arr = [...map.values()]
          .filter((f) => f.uri !== '')
          .sort((a, b) => a.startTime - b.startTime)
        return arr.map((f, i) => ({
          uri: f.uri,
          startTime: f.startTime,
          duration: f.duration,
          // hls.js exposes the HLS discontinuity-sequence counter as `cc`.
          discontinuity: i > 0 && f.cc !== arr[i - 1].cc,
          pdt: f.pdt,
          data: f.data,
        }))
      }

      const video = toSorted(videoAccumRef.current)
      if (video.length === 0) return null
      // Separate AUDIO-group rendition (common with e.g. JW Player/Unified
      // Streaming feeds), if one is in use — video-only segments don't carry it.
      const audio = audioAccumRef.current.size > 0 ? toSorted(audioAccumRef.current) : null
      return { video, audio }
    },
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
    // Fresh source — drop the previous stream's accumulated fragments + bytes.
    resetAccumulation()

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))

      // Accumulate fragments on every playlist (re)load so segments that later
      // scroll out of the live window are still available for export.
      hls.on(Hls.Events.LEVEL_UPDATED, (_evt, data) => {
        const frags = data.details?.fragments
        if (frags) ingestFragments(videoAccumRef.current, frags)
      })
      hls.on(Hls.Events.LEVEL_LOADED, (_evt, data) => {
        const frags = data.details?.fragments
        if (frags) ingestFragments(videoAccumRef.current, frags)
      })
      hls.on(Hls.Events.AUDIO_TRACK_LOADED, (_evt, data) => {
        const frags = data.details?.fragments
        if (frags) ingestFragments(audioAccumRef.current, frags)
      })
      hls.on(Hls.Events.AUDIO_TRACK_UPDATED, (_evt, data) => {
        const frags = data.details?.fragments
        if (frags) ingestFragments(audioAccumRef.current, frags)
      })

      // Capture the raw bytes of each segment as it's downloaded for playback,
      // so export never has to re-fetch a (possibly expired) segment URL.
      hls.on(Hls.Events.FRAG_LOADED, (_evt, data) => {
        const { frag, payload } = data
        if (typeof frag.sn !== 'number' || !payload || payload.byteLength === 0) return
        const track = frag.type === 'audio' ? 'audio' : 'video'
        storeFragmentData(track, frag.sn, new Uint8Array(payload))
      })

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          console.error('[HLS] Fatal error:', data)
          if (data.details === Hls.ErrorDetails.KEY_LOAD_ERROR || data.details === Hls.ErrorDetails.KEY_SYSTEM_NO_KEYS) {
            onError?.('This stream is DRM-encrypted and cannot be played — LiveCut only supports unencrypted HLS streams.')
          } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
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
        muted
      />
    </div>
  )
})

Player.displayName = 'Player'
