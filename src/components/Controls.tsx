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
  disabled: boolean
}

export function Controls({ marks, onMarkIn, onMarkOut, onClearIn, onClearOut, disabled }: Props) {
  return (
    <div className="controls">
      <div className="mark-row">
        <button className="btn btn-mark" onClick={onMarkIn} disabled={disabled} title="I">
          Mark In
        </button>
        <div className="mark-time">
          {marks.in !== null ? (
            <>
              <span className="mark-label">IN</span>
              <span className="mark-value">{formatTime(marks.in)}</span>
              <button className="btn-clear" onClick={onClearIn} title="Clear in point">×</button>
            </>
          ) : (
            <span className="mark-placeholder">—</span>
          )}
        </div>
      </div>

      <div className="mark-row">
        <button className="btn btn-mark" onClick={onMarkOut} disabled={disabled} title="O">
          Mark Out
        </button>
        <div className="mark-time">
          {marks.out !== null ? (
            <>
              <span className="mark-label">OUT</span>
              <span className="mark-value">{formatTime(marks.out)}</span>
              <button className="btn-clear" onClick={onClearOut} title="Clear out point">×</button>
            </>
          ) : (
            <span className="mark-placeholder">—</span>
          )}
        </div>
      </div>

      {marks.in !== null && marks.out !== null && marks.out > marks.in && (
        <div className="clip-duration">
          Duration: <strong>{formatTime(marks.out - marks.in)}</strong>
        </div>
      )}

      {marks.in !== null && marks.out !== null && marks.out <= marks.in && (
        <div className="mark-error">Out point must be after in point.</div>
      )}
    </div>
  )
}
