export interface Segment {
  uri: string
  duration: number
  startTime: number // cumulative start time within the stream
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

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXTINF:')) {
      // Duration is everything between ':' and ',' (some playlists omit the comma)
      const raw = lines[i].slice(8).split(',')[0]
      const duration = parseFloat(raw)
      if (isNaN(duration)) continue

      const rawUri = lines[i + 1]
      if (!rawUri || rawUri.startsWith('#')) continue

      const uri = resolveUri(rawUri, baseUrl)
      segments.push({ uri, duration, startTime: cumulative })
      cumulative += duration
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
