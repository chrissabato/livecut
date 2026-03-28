import { useState } from 'react'

interface Props {
  onLoad: (url: string) => void
  loading: boolean
}

export function UrlBar({ onLoad, loading }: Props) {
  const [value, setValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed) onLoad(trimmed)
  }

  return (
    <form className="url-bar" onSubmit={handleSubmit}>
      <input
        type="url"
        className="url-input"
        placeholder="Paste .m3u8 stream URL…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        required
      />
      <button type="submit" className="btn btn-primary" disabled={loading || !value.trim()}>
        Load
      </button>
    </form>
  )
}
