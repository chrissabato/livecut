/** Format seconds as HH:MM:SS.mmm */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00:00.000'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return [
    h.toString().padStart(2, '0'),
    m.toString().padStart(2, '0'),
    s.toString().padStart(2, '0'),
  ].join(':') + '.' + ms.toString().padStart(3, '0')
}

/** Format seconds as a filename-safe string like 00h01m23s456 */
export function formatTimeForFilename(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00h00m00s000'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${h.toString().padStart(2, '0')}h${m.toString().padStart(2, '0')}m${s.toString().padStart(2, '0')}s${ms.toString().padStart(3, '0')}`
}
