import { useState } from 'react'
import { api, type AccessCode } from '../api'
import { toast } from '../components'
import { Icon } from '../icons'

// Hosted version, opened at /#admin: hand out and revoke access codes. The password stays in memory only.
export default function Admin() {
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<AccessCode[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      setCodes(await api.codes(password))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  function copy(code: string) {
    navigator.clipboard.writeText(code).then(() => toast(`Copied ${code}`)).catch(() => {})
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 16px' }}>
      <div className="ph">
        <div>
          <h1>Access codes</h1>
          <div className="sub">Give one code per tester. Each code sees only its own runs. Revoking a code signs it out.</div>
        </div>
        <a className="btn" href="/">Back to app</a>
      </div>

      {codes === null ? (
        <div className="card"><div className="cb">
          <label className="lbl">Admin password</label>
          <div className="row">
            <div className="inp">
              <input type="password" value={password} autoFocus autoComplete="current-password"
                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && password && act(async () => {})} />
            </div>
            <button className="btn p" disabled={busy || !password} onClick={() => act(async () => {})}>Open</button>
          </div>
          {error && <div className="err">{error}</div>}
        </div></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}><div className="cb">
            <label className="lbl">New code for</label>
            <div className="row">
              <div className="inp">
                <input value={label} placeholder="e.g. Judge — Priya" maxLength={60} onChange={e => setLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && label.trim() && act(async () => {
                    copy((await api.newCode(password, label.trim())).code)
                    setLabel('')
                  })} />
              </div>
              <button className="btn p" disabled={busy || !label.trim()} onClick={() => act(async () => {
                copy((await api.newCode(password, label.trim())).code)
                setLabel('')
              })}><Icon name="plus" size={16} />Create code</button>
            </div>
            {error && <div className="err">{error}</div>}
          </div></div>

          <div className="card">
            <table>
              <thead><tr><th>Code</th><th>For</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {codes.length ? codes.map(c => (
                  <tr key={c.code}>
                    <td><button className="btn s g" title="Copy" onClick={() => copy(c.code)}><code>{c.code}</code></button></td>
                    <td>{c.label}</td>
                    <td className="mut">{new Date(c.created_at).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn s" disabled={busy} onClick={() => confirm(`Revoke ${c.code} (${c.label})?`) && act(() => api.revokeCode(password, c.code))}>
                        <Icon name="trash" size={16} />Revoke
                      </button>
                    </td>
                  </tr>
                )) : <tr><td colSpan={4} className="mut">No codes yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
