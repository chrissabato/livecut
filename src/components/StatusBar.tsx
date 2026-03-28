interface Props {
  stage: string
  percent: number
  error: string | null
  status: 'idle' | 'loading-ffmpeg' | 'exporting' | 'done' | 'error'
}

export function StatusBar({ stage, percent, error, status }: Props) {
  if (status === 'idle') return null

  return (
    <div className={`status-bar status-${status}`}>
      {status === 'error' ? (
        <div className="status-error">{error}</div>
      ) : (
        <>
          <div className="status-stage">{stage}</div>
          {status !== 'done' && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
          )}
          {status === 'done' && (
            <div className="status-done">Download started.</div>
          )}
        </>
      )}
    </div>
  )
}
