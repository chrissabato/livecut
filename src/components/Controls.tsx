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
  onSeekTo: (time: number) => void
  onAdjustIn: (delta: number) => void
  onAdjustOut: (delta: number) => void
  maxDuration: number
  clipName: string
  onClipNameChange: (name: string) => void
  onAddClip: () => void
  canAddClip: boolean
}

const STEPS = [-1, -0.1, 0.1, 1] as const

export function Controls({
  marks, onMarkIn, onMarkOut, onClearIn, onClearOut,
  onSeekTo, onAdjustIn, onAdjustOut, maxDuration,
  clipName, onClipNameChange, onAddClip, canAddClip,
}: Props) {
  const duration = marks.in !== null && marks.out !== null ? marks.out - marks.in : null
  const overLimit = duration !== null && duration > maxDuration
  const nameRef = useRef<HTMLInputElement>(null)

  return (
    <div className="controls">
      {/* Mark In */}
      <div className="mark-section">
        <div className="mark-row">
          <button className="btn btn-mark" onClick={onMarkIn} title="I">Mark In</button>
          {marks.in !== null ? (
            <>
              <button
                className="mark-time-btn"
                onClick={() => onSeekTo(marks.in!)}
                title="Seek to in point"
              >
                {formatTime(marks.in)}
              </button>
              <button className="btn-clear" onClick={onClearIn}>×</button>
            </>
          ) : (
            <span className="mark-placeholder">—</span>
          )}
        </div>
        {marks.in !== null && (
          <div className="adjust-row">
            {STEPS.map((s) => (
              <button
                key={s}
                className="btn-adjust"
                onClick={() => { onAdjustIn(s); onSeekTo(Math.max(0, marks.in! + s)) }}
                title={`${s > 0 ? '+' : ''}${s}s`}
              >
                {s > 0 ? `+${s}s` : `${s}s`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mark Out */}
      <div className="mark-section">
        <div className="mark-row">
          <button className="btn btn-mark" onClick={onMarkOut} title="O">Mark Out</button>
          {marks.out !== null ? (
            <>
              <button
                className="mark-time-btn"
                onClick={() => onSeekTo(marks.out!)}
                title="Seek to out point"
              >
                {formatTime(marks.out)}
              </button>
              <button className="btn-clear" onClick={onClearOut}>×</button>
            </>
          ) : (
            <span className="mark-placeholder">—</span>
          )}
        </div>
        {marks.out !== null && (
          <div className="adjust-row">
            {STEPS.map((s) => (
              <button
                key={s}
                className="btn-adjust"
                onClick={() => { onAdjustOut(s); onSeekTo(Math.max(0, marks.out! + s)) }}
                title={`${s > 0 ? '+' : ''}${s}s`}
              >
                {s > 0 ? `+${s}s` : `${s}s`}
              </button>
            ))}
          </div>
        )}
      </div>

      {marks.in !== null && marks.out !== null && (
        marks.out <= marks.in ? (
          <div className="mark-error">Out point must be after in point.</div>
        ) : overLimit ? (
          <div className="mark-warning">
            Clip is {formatTime(duration!)} — exceeds the {formatTime(maxDuration)} limit.
            Long clips may exhaust browser memory.
          </div>
        ) : (
          <div className="clip-duration-hint">Duration: <strong>{formatTime(duration!)}</strong></div>
        )
      )}

      {/* Add clip */}
      <div className="add-clip-row">
        <input
          ref={nameRef}
          className="clip-name-input"
          type="text"
          placeholder="Clip name…"
          value={clipName}
          onChange={(e) => onClipNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canAddClip && onAddClip()}
          maxLength={64}
        />
        <button
          className="btn btn-primary"
          onClick={() => { onAddClip(); nameRef.current?.focus() }}
          disabled={!canAddClip}
        >
          Add
        </button>
      </div>
    </div>
  )
}
