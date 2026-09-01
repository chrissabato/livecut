import { FFmpeg } from '@ffmpeg/ffmpeg'
import { parsePlaylist, coversRange, Segment } from './m3u8Parser'

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

  // 2a. Make sure the marked range is actually inside the available segment
  //     window. Live playlists only keep recent segments, so marks set a while
  //     ago can roll off the front — exporting anyway would silently truncate
  //     the clip and knock audio/video out of alignment.
  const windowError =
    'The selected range is outside the currently available stream window. ' +
    'Live streams only keep recent segments — mark the clip sooner after it airs, ' +
    'or load a DVR/VOD URL.'
  if (!coversRange(videoSegments, inTime, outTime)) throw new Error(windowError)
  if (audioSegments && !coversRange(audioSegments, inTime, outTime)) throw new Error(windowError)

  // 2b. Filter each track to segments that overlap [inTime, outTime]
  const inRange = (segs: Segment[]) =>
    segs.filter((seg) => seg.startTime < outTime && seg.startTime + seg.duration > inTime)

  const videoInRange = inRange(videoSegments)
  if (videoInRange.length === 0) {
    throw new Error('No segments found for the selected time range.')
  }
  const audioInRange = audioSegments ? inRange(audioSegments) : null

  const crossesDiscontinuity =
    videoInRange.some((s, i) => i > 0 && s.discontinuity) ||
    (audioInRange?.some((s, i) => i > 0 && s.discontinuity) ?? false)
  if (crossesDiscontinuity) {
    console.warn(
      '[LiveCut] Selected range crosses an #EXT-X-DISCONTINUITY — timestamps reset ' +
      'mid-clip; audio/video sync across the boundary may vary by player.'
    )
  }

  // 3. Download segments and write to FFmpeg virtual FS
  const totalSegments = videoInRange.length + (audioInRange?.length ?? 0)
  let downloaded = 0

  const downloadTrack = async (segs: Segment[], prefix: string): Promise<string[]> => {
    const files: string[] = []
    for (let i = 0; i < segs.length; i++) {
      downloaded++

      // Prefer bytes the player already captured — immune to signed-URL expiry
      // and segment CORS. Only hit the network for segments no longer buffered.
      const buffered = segs[i].data
      let data: Uint8Array
      if (buffered && buffered.byteLength > 0) {
        onProgress({
          stage: `Reading buffered segment ${downloaded} of ${totalSegments}…`,
          percent: Math.round(5 + (downloaded / totalSegments) * 55),
        })
        // ffmpeg.writeFile transfers (detaches) the ArrayBuffer, so hand it a
        // copy — the original must survive for a later export of an overlapping clip.
        data = buffered.slice()
      } else {
        onProgress({
          stage: `Downloading segment ${downloaded} of ${totalSegments}…`,
          percent: Math.round(5 + (downloaded / totalSegments) * 55),
        })
        const res = await fetch(segs[i].uri)
        if (!res.ok) {
          throw new Error(
            `Failed to download segment (HTTP ${res.status}). ` +
            `The segment is no longer in the player's buffer and its URL has expired — ` +
            `mark the clip sooner after it airs, or use a DVR/VOD URL.`
          )
        }
        data = new Uint8Array(await res.arrayBuffer())
      }

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

  // 5. Build the FFmpeg argument list. Two very different paths:
  //
  //    (a) Muxed A/V (one concat). ffmpeg's concat-demuxer seek is unreliable,
  //        and with -c copy it drops the partial GOP of video before the first
  //        keyframe while keeping that span's audio — then papers over the
  //        missing video with an empty edit (elst mediaTime=-1). Players that
  //        ignore empty edits (browsers included) render the whole clip a second
  //        or two out of sync. So we DON'T seek: the concat already starts on
  //        the first in-range segment's boundary (an IDR with aligned audio),
  //        and we only cap the tail with -t. The clip therefore begins at that
  //        segment boundary — up to one segment duration (typically 2–6 s)
  //        before the marked in-point.
  //
  //    (b) Separate AUDIO-group rendition. Each track is its own concat with its
  //        own boundaries; input-seek both, anchoring the audio seek to the same
  //        wall-clock instant as the video seek via PROGRAM-DATE-TIME when the
  //        playlist carries it, and normalise negative pre-roll with make_zero.

  onProgress({ stage: 'Processing with FFmpeg…', percent: 65 })

  const progressHandler = ({ progress }: { progress: number }) => {
    // FFmpeg progress is 0–1 based on output duration
    onProgress({
      stage: 'Processing with FFmpeg…',
      percent: Math.round(65 + progress * 30),
    })
  }
  ffmpeg.on('progress', progressHandler)

  const args: string[] = []
  // #EXT-X-DISCONTINUITY resets PTS mid-stream; rebuild timestamps so concat
  // doesn't emit jumps that players interpret as A/V drift.
  if (crossesDiscontinuity) args.push('-fflags', '+genpts')

  if (!audioFiles) {
    // (a) Muxed — no seek, trim only the tail.
    const outDuration = outTime - videoInRange[0].startTime
    args.push(
      '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
      '-t', outDuration.toFixed(3),
      '-c', 'copy',
      '-movflags', '+faststart',
      'output.mp4'
    )
  } else {
    // (b) Separate audio rendition — input-seek each track to aligned offsets.
    let duration = outTime - inTime
    let trimStartVideo = Math.max(0, inTime - videoInRange[0].startTime)

    const vSeg = videoInRange[0]
    const aSeg = audioInRange![0]
    // Video-axis time that the first in-range audio segment begins at.
    const audioBaseOnVideoAxis =
      vSeg.pdt != null && aSeg.pdt != null
        ? vSeg.startTime + (aSeg.pdt - vSeg.pdt) / 1000
        : aSeg.startTime
    let trimStartAudio = inTime - audioBaseOnVideoAxis

    // Can't seek before the start of the concatenated audio — if the aligned
    // offset is negative, push both cuts later by the shortfall so they stay
    // locked together (the clip just starts that fraction of a second later).
    if (trimStartAudio < 0) {
      const shift = -trimStartAudio
      trimStartAudio = 0
      trimStartVideo += shift
      duration -= shift
    }

    args.push(
      '-f', 'concat', '-safe', '0', '-ss', trimStartVideo.toFixed(3), '-i', 'concat.txt',
      '-f', 'concat', '-safe', '0', '-ss', trimStartAudio.toFixed(3), '-i', 'audioconcat.txt',
      '-t', duration.toFixed(3),
      '-map', '0:v:0', '-map', '1:a:0',
      '-c', 'copy',
      // Keyframe-snapped video seeks leave a short pre-roll with negative
      // timestamps; normalise so the muxer doesn't offset one track vs the other.
      '-avoid_negative_ts', 'make_zero',
      '-muxdelay', '0', '-muxpreload', '0',
      '-movflags', '+faststart',
      'output.mp4'
    )
  }

  try {
    await ffmpeg.exec(args)
  } finally {
    ffmpeg.off('progress', progressHandler)
  }

  // 6. Read output
  onProgress({ stage: 'Finalizing…', percent: 97 })
  const outputData = await ffmpeg.readFile('output.mp4') as Uint8Array<ArrayBuffer>

  // 7. Cleanup virtual FS
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
