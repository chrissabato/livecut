export interface Segment {
  uri: string
  duration: number
  startTime: number // cumulative start time within the stream
}

export interface ParsedPlaylist {
  segments: Segment[]
  totalDuration: number
}

/**
 * Fetches and parses an HLS playlist URL.
 * Handles both master playlists (picks highest-bandwidth variant) and media playlists.
 * Resolves relative segment URIs against the playlist's own URL.
 */
export async function parsePlaylist(url: string): Promise<ParsedPlaylist> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch playlist (${response.status}). ` +
      `The stream URL must allow cross-origin access (CORS: Access-Control-Allow-Origin: *).`
    )
  }
  const text = await response.text()
  return parsePlaylistText(text, url)
}

async function parsePlaylistText(text: string, baseUrl: string): Promise<ParsedPlaylist> {
  // Master playlist — pick the highest-bandwidth variant
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variantUrl = extractHighestBandwidthVariant(text, baseUrl)
    if (!variantUrl) throw new Error('Could not find a valid variant stream in master playlist')
    return parsePlaylist(variantUrl)
  }

  // Media playlist — parse segments
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

function extractHighestBandwidthVariant(text: string, baseUrl: string): string | null {
  const lines = text.split('\n').map(l => l.trim())
  let bestBandwidth = -1
  let bestUri: string | null = null

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/)
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0
      const uri = lines[i + 1]
      if (uri && !uri.startsWith('#') && bandwidth > bestBandwidth) {
        bestBandwidth = bandwidth
        bestUri = resolveUri(uri, baseUrl)
      }
    }
  }

  return bestUri
}

function resolveUri(uri: string, baseUrl: string): string {
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri
  return new URL(uri, baseUrl).href
}
