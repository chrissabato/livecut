export interface Clip {
  id: string
  name: string
  in: number
  out: number
  exportStatus: 'idle' | 'loading-ffmpeg' | 'exporting' | 'done' | 'error'
  exportProgress: number
  exportError: string | null
}
