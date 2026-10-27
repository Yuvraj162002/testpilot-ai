import { useEffect, useState } from 'react'
import { api, VIEWPORTS, type Settings as S, type Viewport } from '../api'
import { toast } from '../components'
import { Icon } from '../icons'

const TOGGLES: [keyof S, string, string][] = [
  ['screenshots', 'Capture screenshots', 'Saved as evidence at the end of every test.'],
  ['console_logs', 'Record errors', 'Browser console errors, or app errors from Android logcat.'],
  ['network_errors', 'Capture network errors', 'Failed requests and 4xx or 5xx responses (websites).'],
  ['retry_failed', 'Retry failed tests once', 'Helps filter out flaky results. Failed tests take twice as long.'],
  ['ask_when_unsure', 'Ask me when unsure', 'The AI pauses a test and asks you: unclear screens, missing test data, and before submitting forms, registering, deleting or paying.'],
]

export default function Settings() {
  const [s, setS] = useState<S | null>(null)
  const [ai, setAi] = useState<{ provider: string; model: string } | null>(null)
  const [conn, setConn] = useState<'idle' | 'checking' | 'ok' | 'down'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    api.settings().then(setS).catch(e => setError(e.message))
    api.health().then(h => { setAi(h); setConn('ok') }).catch(() => setConn('down'))
  }, [])

  async function save() {
    try {
      setS(await api.saveSettings(s!))
      toast('Settings saved')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function check() {
    setConn('checking')
    try {
      setAi(await api.health())
      setConn('ok')
      toast('Backend connected')
    } catch {
      setConn('down')
    }
  }

  if (error) return <div className="err">{error}</div>
  if (!s) return <div className="sk" style={{ height: 300 }} />

  return (
    <>
      <div className="ph">
        <div><h1>Settings</h1><div className="sub">Defaults for new runs, test execution and AI.</div></div>
        <button className="btn p" onClick={save}><Icon name="check" size={16} />Save changes</button>
      </div>
      <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div className="ch">New test runs</div>
          <div className="cb" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label className="lbl">Default target</label>
              <div className="inp">
                <select value={s.default_platform} onChange={e => setS({ ...s, default_platform: e.target.value as S['default_platform'] })}>
                  <option value="web">Website</option>
                  <option value="android">Android app (APK)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="lbl">Default viewport (websites)</label>
              <div className="inp">
                <select value={s.default_viewport} onChange={e => setS({ ...s, default_viewport: e.target.value as Viewport })}>
                  {(Object.keys(VIEWPORTS) as Viewport[]).map(v => <option key={v} value={v}>{v} · {VIEWPORTS[v]}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="ch">Test execution</div>
          <div className="cb" style={{ paddingTop: 2, paddingBottom: 2 }}>
            {TOGGLES.map(([k, title, desc]) => (
              <div key={k} className="row" style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
                <div><div className="f5">{title}</div><div className="mut" style={{ fontSize: 13 }}>{desc}</div></div>
                <button className={`tg sp ${s[k] ? 'on' : ''}`} role="switch" aria-checked={!!s[k]} aria-label={title}
                  onClick={() => setS({ ...s, [k]: !s[k] })} />
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="ch">
            AI provider
            {conn === 'ok' ? <span className="b d ok">Connected</span> : conn === 'checking' ? <span className="b d ind">Checking…</span>
              : conn === 'down' ? <span className="b d bad">Backend not reachable</span> : <span className="b d neu">Not checked</span>}
          </div>
          <div className="cb" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label className="lbl">Provider</label>
              <div className="inp"><span>{ai?.provider === 'api' ? 'Anthropic API key' : 'Claude Code login (no API key)'}</span></div>
            </div>
            <div>
              <label className="lbl">Model</label>
              <div className="inp"><span>{ai?.model ?? '–'}</span></div>
            </div>
            <div style={{ gridColumn: '1/3' }}>
              <div className="row">
                <div className="hint" style={{ marginTop: 0 }}>
                  Set in <code>backend/.env</code> (<code>AI_PROVIDER</code>, <code>CLAUDE_MODEL</code>). Keys stay on the server, never in the browser.
                </div>
                <button className="btn sp" onClick={check}>Test connection</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
