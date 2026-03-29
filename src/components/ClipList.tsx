import { useState } from 'react'
import { Clip } from '../lib/types'
import { formatTime } from '../lib/formatTime'

interface Props {
  clips: Clip[]
  exportingId: string | null
  ffmpegLoading: boolean
  onExport: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onPreview: (id: string) => void
}

export function ClipList({ clips, exportingId, ffmpegLoading, onExport, onDelete, onRename, onPreview }: Props) {
  return (
    <div className="clip-list">
      <div className="clip-list-header">Clips ({clips.length})</div>
      {clips.map((clip) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          isExporting={exportingId === clip.id}
          isBlocked={exportingId !== null && exportingId !== clip.id}
          ffmpegLoading={ffmpegLoading && exportingId === clip.id}
          onExport={() => onExport(clip.id)}
          onDelete={() => onDelete(clip.id)}
          onRename={(name) => onRename(clip.id, name)}
          onPreview={() => onPreview(clip.id)}
        />
      ))}
    </div>
  )
}

interface ItemProps {
  clip: Clip
  isExporting: boolean
  isBlocked: boolean
  ffmpegLoading: boolean
  onExport: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onPreview: () => void
}

function ClipItem({ clip, isExporting, isBlocked, ffmpegLoading, onExport, onDelete, onRename, onPreview }: ItemProps) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(clip.name)

  const commitRename = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== clip.name) onRename(trimmed)
    else setDraftName(clip.name) // revert if empty
    setEditing(false)
  }

  const duration = clip.out - clip.in

  const exportLabel = () => {
    if (clip.exportStatus === 'loading-ffmpeg') return 'Loading…'
    if (isExporting) return 'Exporting…'
    if (ffmpegLoading) return 'Loading…'
    if (clip.exportStatus === 'done') return 'Download again'
    return 'Export'
  }

  return (
    <div className={`clip-item clip-item--${clip.exportStatus}`}>
      <div className="clip-item-top">
        {editing ? (
          <input
            className="clip-name-edit"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(clip.name); setEditing(false) }
            }}
            maxLength={64}
          />
        ) : (
          <button
            className="clip-name"
            onClick={() => { setDraftName(clip.name); setEditing(true) }}
            title="Click to rename"
          >
            {clip.name}
          </button>
        )}
        <button className="btn-clear" onClick={onDelete} title="Delete clip">×</button>
      </div>

      <div className="clip-times">
        {formatTime(clip.in)} → {formatTime(clip.out)}
        <span className="clip-duration"> · {formatTime(duration)}</span>
      </div>

      <div className="clip-actions">
        <button className="btn btn-secondary" onClick={onPreview}>
          Preview
        </button>
        <button
          className={`btn btn-export-clip ${clip.exportStatus === 'done' ? 'btn-export-done' : ''}`}
          onClick={onExport}
          disabled={isExporting || isBlocked || clip.exportStatus === 'loading-ffmpeg'}
        >
          {exportLabel()}
        </button>
      </div>

      {(isExporting || clip.exportStatus === 'loading-ffmpeg') && (
        <div className="clip-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${clip.exportProgress}%` }} />
          </div>
          <span className="clip-progress-pct">{clip.exportProgress}%</span>
        </div>
      )}

      {clip.exportStatus === 'error' && clip.exportError && (
        <div className="clip-error">{clip.exportError}</div>
      )}
    </div>
  )
}
