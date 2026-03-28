import { useRef } from 'react'
import { formatTime } from '../lib/formatTime'

interface Marks {
  in: number | null
  out: number | null
}

interface Props {
  marks: Marks
  onMarkIn: () => void
  onMarkOut: () => void
  onClearIn: () => void
  onClearOut: () => void
  clipName: string
  onClipNameChange: (name: string) => void
  onAddClip: () => void
  canAddClip: boolean
}

export function Controls({
  marks, onMarkIn, onMarkOut, onClearIn, onClearOut,
  clipName, onClipNameChange, onAddClip, canAddClip,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null)

  const handleAddClick = () => {
    onAddClip()
    nameRef.current?.focus()
  }

  return (
    <div className="controls">
      <div className="mark-row">
        <button className="btn btn-mark" onClick={onMarkIn} title="I">Mark In</button>
        <div className="mark-time">
          {marks.in !== null ? (
            <>
              <span className="mark-label">IN</span>
              <span className="mark-value">{formatTime(marks.in)}</span>
              <button className="btn-clear" onClick={onClearIn}>×</button>
            </>
          ) : (
            <span className="mark-placeholder">—</span>
          )}
        </div>
      </div>

      <div className="mark-row">
        <button className="btn btn-mark" onClick={onMarkOut} title="O">Mark Out</button>
        <div className="mark-time">
          {marks.out !== null ? (
            <>
              <span className="mark-label">OUT</span>
              <span className="mark-value">{formatTime(marks.out)}</span>
              <button className="btn-clear" onClick={onClearOut}>×</button>
            </>
          ) : (
            <span className="mark-placeholder">—</span>
          )}
        </div>
      </div>

      {marks.in !== null && marks.out !== null && marks.out <= marks.in && (
        <div className="mark-error">Out point must be after in point.</div>
      )}

      <div className="add-clip-row">
        <input
          ref={nameRef}
          className="clip-name-input"
          type="text"
          placeholder={`Clip ${/* will be filled by parent */''}`}
          value={clipName}
          onChange={(e) => onClipNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canAddClip && handleAddClick()}
          maxLength={64}
        />
        <button
          className="btn btn-primary"
          onClick={handleAddClick}
          disabled={!canAddClip}
        >
          Add
        </button>
      </div>
    </div>
  )
}
