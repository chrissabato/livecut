import { FFmpeg } from '@ffmpeg/ffmpeg'
import { parsePlaylist, Segment } from './m3u8Parser'

export interface ExportProgress {
  stage: string
  percent: number // 0–100
}

export interface TrackSegments {
  video: Segment[]
  audio: Segment[] | null
}

/**
 * Downloads the relevant HLS segments for [inTime, outTime], writes them to
 * FFmpeg's virtual filesystem, concatenates them, trims to the exact range,
 * and returns the result as an MP4 Blob.
 *
 * Some streams (e.g. JW Player / Unified Streaming feeds) publish audio as a
 * separate AUDIO-group rendition rather than muxing it into the video
 * segments — when that's the case, both tracks are downloaded and muxed
 * together in the final FFmpeg pass.
 *
 * Uses -c copy (stream copy) — no re-encoding, fast, keyframe-accurate trim.
 */
export async function clipVideo(
  source: string | TrackSegments,
  inTime: number,
  outTime: number,
  ffmpeg: FFmpeg,
  onProgress: (p: ExportProgress) => void
): Promise<Blob> {
  // 1. Resolve segments (or use pre-parsed segments from HLS.js to avoid re-fetching expired URLs)
  onProgress({ stage: 'Parsing playlist…', percent: 2 })
  let videoSegments: Segment[]
  let audioSegments: Segment[] | null

  if (typeof source === 'string') {
    const playlist = await parsePlaylist(source)
    videoSegments = playlist.video.segments
    audioSegments = playlist.audio?.segments ?? null
  } else {
    videoSegments = source.video
    audioSegments = source.audio
  }

  // 2. Filter each track to segments that overlap [inTime, outTime]
  const inRange = (segs: Segment[]) =>
    segs.filter((seg) => seg.startTime < outTime && seg.startTime + seg.duration > inTime)

  const videoInRange = inRange(videoSegments)
  if (videoInRange.length === 0) {
    throw new Error('No segments found for the selected time range.')
  }
  const audioInRange = audioSegments ? inRange(audioSegments) : null

  // 3. Download segments and write to FFmpeg virtual FS
  const totalSegments = videoInRange.length + (audioInRange?.length ?? 0)
  let downloaded = 0

  const downloadTrack = async (segs: Segment[], prefix: string): Promise<string[]> => {
    const files: string[] = []
    for (let i = 0; i < segs.length; i++) {
      downloaded++
      onProgress({
        stage: `Downloading segment ${downloaded} of ${totalSegments}…`,
        percent: Math.round(5 + (downloaded / totalSegments) * 55),
      })

      const res = await fetch(segs[i].uri)
      if (!res.ok) {
        throw new Error(
          `Failed to download segment (HTTP ${res.status}). ` +
          `Check that the stream allows cross-origin requests.`
        )
      }

      const data = new Uint8Array(await res.arrayBuffer())
      const filename = `${prefix}${i.toString().padStart(4, '0')}.ts`
      await ffmpeg.writeFile(filename, data)
      files.push(filename)
    }
    return files
  }

  const videoFiles = await downloadTrack(videoInRange, 'vseg')
  const audioFiles = audioInRange && audioInRange.length > 0
    ? await downloadTrack(audioInRange, 'aseg')
    : null

  // 4. Write concat lists
  onProgress({ stage: 'Preparing segments…', percent: 62 })
  await ffmpeg.writeFile('concat.txt', videoFiles.map((f) => `file '${f}'`).join('\n'))
  if (audioFiles) {
    await ffmpeg.writeFile('audioconcat.txt', audioFiles.map((f) => `file '${f}'`).join('\n'))
  }

  // 5. Calculate trim offsets within each concatenated track
  const duration = outTime - inTime
  const trimStartVideo = Math.max(0, inTime - videoInRange[0].startTime)

  // 6. Run FFmpeg: concat → trim → mux → MP4
  onProgress({ stage: 'Processing with FFmpeg…', percent: 65 })

  const progressHandler = ({ progress }: { progress: number }) => {
    // FFmpeg progress is 0–1 based on output duration
    onProgress({
      stage: 'Processing with FFmpeg…',
      percent: Math.round(65 + progress * 30),
    })
  }
  ffmpeg.on('progress', progressHandler)

  const args = [
    '-f', 'concat', '-safe', '0',
    '-ss', trimStartVideo.toFixed(3), '-t', duration.toFixed(3),
    '-i', 'concat.txt',
  ]
  if (audioFiles) {
    const trimStartAudio = Math.max(0, inTime - audioInRange![0].startTime)
    args.push(
      '-f', 'concat', '-safe', '0',
      '-ss', trimStartAudio.toFixed(3), '-t', duration.toFixed(3),
      '-i', 'audioconcat.txt',
      '-map', '0:v:0', '-map', '1:a:0'
    )
  }
  args.push('-c', 'copy', '-movflags', '+faststart', 'output.mp4')

  try {
    await ffmpeg.exec(args)
  } finally {
    ffmpeg.off('progress', progressHandler)
  }

  // 7. Read output
  onProgress({ stage: 'Finalizing…', percent: 97 })
  const outputData = await ffmpeg.readFile('output.mp4') as Uint8Array<ArrayBuffer>

  // 8. Cleanup virtual FS
  const filesToDelete = [
    ...videoFiles,
    ...(audioFiles ?? []),
    'concat.txt',
    ...(audioFiles ? ['audioconcat.txt'] : []),
    'output.mp4',
  ]
  await Promise.all(filesToDelete.map((f) => ffmpeg.deleteFile(f).catch(() => {})))

  onProgress({ stage: 'Done!', percent: 100 })
  return new Blob([outputData], { type: 'video/mp4' })
}
