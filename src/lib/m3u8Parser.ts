export interface Segment {
  uri: string
  duration: number
  startTime: number // cumulative start time within the stream
  /** True when this segment is preceded by an #EXT-X-DISCONTINUITY tag. */
  discontinuity?: boolean
  /** Program date-time (epoch ms) for the start of this segment, if the playlist carries it. */
  pdt?: number | null
}

export interface Track {
  segments: Segment[]
  totalDuration: number
}

export interface ParsedStream {
  video: Track
  audio: Track | null
}

/**
 * Fetches and parses an HLS playlist URL.
 * Handles both master playlists (picks highest-bandwidth variant, plus its
 * associated audio rendition if the variant references a separate AUDIO
 * group) and plain media playlists.
 * Resolves relative segment URIs against the playlist's own URL.
 */
export async function parsePlaylist(url: string): Promise<ParsedStream> {
  const text = await fetchText(url)
  return parsePlaylistText(text, url)
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch playlist (${response.status}). ` +
      `The stream URL must allow cross-origin access (CORS: Access-Control-Allow-Origin: *).`
    )
  }
  return response.text()
}

async function parsePlaylistText(text: string, baseUrl: string): Promise<ParsedStream> {
  // Master playlist — pick the highest-bandwidth variant (and its audio group, if any)
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = extractHighestBandwidthVariant(text, baseUrl)
    if (!variant) throw new Error('Could not find a valid variant stream in master playlist')

    const videoText = await fetchText(variant.uri)
    const video = parseMediaPlaylistText(videoText, variant.uri)

    let audio: Track | null = null
    if (variant.audioGroupId) {
      const audioUrl = extractAudioGroupUri(text, variant.audioGroupId, baseUrl)
      if (audioUrl) {
        const audioText = await fetchText(audioUrl)
        audio = parseMediaPlaylistText(audioText, audioUrl)
      }
    }

    return { video, audio }
  }

  // Already a media playlist
  return { video: parseMediaPlaylistText(text, baseUrl), audio: null }
}

function parseMediaPlaylistText(text: string, baseUrl: string): Track {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const segments: Segment[] = []
  let cumulative = 0
  let pendingDiscontinuity = false
  // Running program date-time. An explicit tag resets it; otherwise it advances
  // by each segment's duration so every segment gets an absolute anchor.
  let currentPdt: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line === '#EXT-X-DISCONTINUITY') {
      pendingDiscontinuity = true
      continue
    }

    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const parsed = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim())
      currentPdt = isNaN(parsed) ? currentPdt : parsed
      continue
    }

    if (line.startsWith('#EXTINF:')) {
      // Duration is everything between ':' and ',' (some playlists omit the comma)
      const raw = line.slice(8).split(',')[0]
      const duration = parseFloat(raw)
      if (isNaN(duration)) continue

      const rawUri = lines[i + 1]
      if (!rawUri || rawUri.startsWith('#')) continue

      const uri = resolveUri(rawUri, baseUrl)
      segments.push({
        uri,
        duration,
        startTime: cumulative,
        discontinuity: pendingDiscontinuity,
        pdt: currentPdt,
      })
      cumulative += duration
      if (currentPdt != null) currentPdt += duration * 1000
      pendingDiscontinuity = false
      i++ // skip the URI line
    }
  }

  if (segments.length === 0) {
    throw new Error('No segments found in playlist. The URL may not be a valid HLS stream.')
  }

  return { segments, totalDuration: cumulative }
}

function extractHighestBandwidthVariant(
  text: string,
  baseUrl: string
): { uri: string; audioGroupId: string | null } | null {
  const lines = text.split('\n').map(l => l.trim())
  let bestBandwidth = -1
  let best: { uri: string; audioGroupId: string | null } | null = null

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/)
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0
      const uri = lines[i + 1]
      if (uri && !uri.startsWith('#') && bandwidth > bestBandwidth) {
        const audioMatch = lines[i].match(/AUDIO="([^"]+)"/)
        bestBandwidth = bandwidth
        best = { uri: resolveUri(uri, baseUrl), audioGroupId: audioMatch ? audioMatch[1] : null }
      }
    }
  }

  return best
}

/** Finds the URI of the EXT-X-MEDIA audio rendition matching the given GROUP-ID. */
function extractAudioGroupUri(text: string, groupId: string, baseUrl: string): string | null {
  const lines = text.split('\n').map(l => l.trim())

  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:') || !line.includes('TYPE=AUDIO')) continue
    const groupMatch = line.match(/GROUP-ID="([^"]+)"/)
    if (groupMatch?.[1] !== groupId) continue
    const uriMatch = line.match(/URI="([^"]+)"/)
    if (!uriMatch) return null
    return resolveUri(uriMatch[1], baseUrl)
  }

  return null
}

function resolveUri(uri: string, baseUrl: string): string {
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri
  return new URL(uri, baseUrl).href
}

/**
 * Whether the given (time-ordered) segment list actually spans [inTime, outTime].
 * Live playlists only retain a sliding window, so marks set a while ago can fall
 * off the front before export — in which case the clip would be silently
 * truncated or misaligned.
 */
export function coversRange(segments: Segment[], inTime: number, outTime: number): boolean {
  if (segments.length === 0) return false
  const first = segments[0]
  const last = segments[segments.length - 1]
  const EPS = 0.5 // tolerate sub-second rounding in EXTINF durations
  return first.startTime <= inTime + EPS && last.startTime + last.duration >= outTime - EPS
}
