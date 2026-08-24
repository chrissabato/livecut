import { useState } from 'react'

interface Props {
  proxyUrl: string
  onSave: (url: string) => void
  onClose: () => void
}

export function SettingsModal({ proxyUrl, onSave, onClose }: Props) {
  const [value, setValue] = useState(proxyUrl)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(value.trim())
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>Advanced settings</span>
          <button type="button" className="settings-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="settings-label" htmlFor="proxy-url-field">
            Proxy URL override
          </label>
          <input
            id="proxy-url-field"
            className="settings-input"
            type="url"
            placeholder="https://your-proxy.example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="settings-hint">
            Overrides the built-in proxy for this browser only. Leave blank to use the default.
          </p>
          <div className="settings-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}
