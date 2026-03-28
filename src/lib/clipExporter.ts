import { FFmpeg } from '@ffmpeg/ffmpeg'
import { parsePlaylist } from './m3u8Parser'

export interface ExportProgress {
  stage: string
  percent: number // 0–100
}

/**
 * Downloads the relevant HLS segments for [inTime, outTime], writes them to
 * FFmpeg's virtual filesystem, concatenates them, trims to the exact range,
 * and returns the result as an MP4 Blob.
 *
 * Uses -c copy (stream copy) — no re-encoding, fast, keyframe-accurate trim.
 */
export async function clipVideo(
  m3u8Url: string,
  inTime: number,
  outTime: number,
  ffmpeg: FFmpeg,
  onProgress: (p: ExportProgress) => void
): Promise<Blob> {
  // 1. Parse playlist
  onProgress({ stage: 'Parsing playlist…', percent: 2 })
  const playlist = await parsePlaylist(m3u8Url)

  // 2. Filter to segments that overlap [inTime, outTime]
  const segments = playlist.segments.filter(
    (seg) => seg.startTime < outTime && seg.startTime + seg.duration > inTime
  )

  if (segments.length === 0) {
    throw new Error('No segments found for the selected time range.')
  }

  // 3. Download segments and write to FFmpeg virtual FS
  const segmentFiles: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const downloadPct = (i / segments.length) * 55 // 0–55%
    onProgress({
      stage: `Downloading segment ${i + 1} of ${segments.length}…`,
      percent: Math.round(5 + downloadPct),
    })

    const res = await fetch(seg.uri)
    if (!res.ok) {
      throw new Error(
        `Failed to download segment ${i + 1} (HTTP ${res.status}). ` +
        `Check that the stream allows cross-origin requests.`
      )
    }

    const data = new Uint8Array(await res.arrayBuffer())
    const filename = `seg${i.toString().padStart(4, '0')}.ts`
    await ffmpeg.writeFile(filename, data)
    segmentFiles.push(filename)
  }

  // 4. Write concat list
  onProgress({ stage: 'Preparing segments…', percent: 62 })
  const concatContent = segmentFiles.map((f) => `file '${f}'`).join('\n')
  await ffmpeg.writeFile('concat.txt', concatContent)

  // 5. Calculate trim offsets within the concatenated file
  const firstSegStart = segments[0].startTime
  const trimStart = Math.max(0, inTime - firstSegStart)
  const duration = outTime - inTime

  // 6. Run FFmpeg: concat → trim → MP4
  onProgress({ stage: 'Processing with FFmpeg…', percent: 65 })

  const progressHandler = ({ progress }: { progress: number }) => {
    // FFmpeg progress is 0–1 based on output duration
    onProgress({
      stage: 'Processing with FFmpeg…',
      percent: Math.round(65 + progress * 30),
    })
  }
  ffmpeg.on('progress', progressHandler)

  try {
    await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat.txt',
      '-ss', trimStart.toFixed(3),
      '-t', duration.toFixed(3),
      '-c', 'copy',
      '-movflags', '+faststart',
      'output.mp4',
    ])
  } finally {
    ffmpeg.off('progress', progressHandler)
  }

  // 7. Read output
  onProgress({ stage: 'Finalizing…', percent: 97 })
  const outputData = await ffmpeg.readFile('output.mp4') as Uint8Array<ArrayBuffer>

  // 8. Cleanup virtual FS
  const filesToDelete = [...segmentFiles, 'concat.txt', 'output.mp4']
  await Promise.all(filesToDelete.map((f) => ffmpeg.deleteFile(f).catch(() => {})))

  onProgress({ stage: 'Done!', percent: 100 })
  return new Blob([outputData], { type: 'video/mp4' })
}
