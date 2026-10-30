import { useEffect, useState } from 'react'
import { api, VIEWPORTS, type Platform, type Target, type Viewport } from '../api'
import type { Screen } from '../App'
import { Steps } from '../components'
import { Icon, type IconName } from '../icons'

const WEB_EXAMPLES = [
  'Test the login page.\n- Sign in with valid credentials and land on the dashboard\n- Show an error for a wrong password\n- Check the forgot password link opens the reset form',
  'Test the checkout flow as a guest user.\n- Add a product to the cart\n- Apply the discount code SAVE10\n- Fill in email, name and address\n- Place the order and confirm the order confirmation page appears',
]
const APP_EXAMPLE =
  'Test the first app start.\n- Go through the onboarding screens and reach the home screen\n- Open each bottom navigation tab and check it loads without an error\n- Open the search and check results appear for a word shown on the home screen'

const APK_KEY = 'testpilot.lastApk'
const readApk = () => {
  try {
    return localStorage.getItem(APK_KEY) || ''
  } catch {
    return ''
  }
}

const isUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

// Shown while the plan is generated; the backend does these in order (we only know when it is done).
const PHASES: Record<Platform, string[]> = {
  web: ['Opening the page in a browser', 'Reading the page structure', 'Writing test cases from your requirements'],
  android: ['Installing the app on the device', 'Opening the app and reading the first screen', 'Writing test cases from your requirements'],
}
const PHASE_MS = 4000

export default function NewRun({ go, prefill }: { go: (s: Screen) => void; prefill?: Partial<Target> }) {
  const [platform, setPlatform] = useState<Platform>(prefill?.platform ?? 'web')
  const [ios, setIos] = useState(false) // iOS tab only shows "coming soon"
  const [url, setUrl] = useState(prefill?.platform !== 'android' ? prefill?.url ?? '' : '')
  const [apk, setApk] = useState(prefill?.platform === 'android' ? prefill.url ?? '' : readApk())
  const [clearData, setClearData] = useState(prefill?.clear_data ?? true)
  const [devices, setDevices] = useState<string[] | null>(null)
  const [req, setReq] = useState(platform === 'android' ? APP_EXAMPLE : WEB_EXAMPLES[0])
  const [viewport, setViewport] = useState<Viewport>(prefill?.viewport ?? 'Desktop')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState(0)

  // Settings defaults, unless this screen was opened with a prefilled target (e.g. "re-run").
  useEffect(() => {
    if (prefill) return
    api.settings().then(s => {
      setViewport(s.default_viewport)
      if (s.default_platform === 'android') choose('android')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!busy) return setPhase(0)
    const t = window.setInterval(() => setPhase(p => Math.min(p + 1, PHASES[platform].length - 1)), PHASE_MS)
    return () => window.clearInterval(t)
  }, [busy, platform])

  // Android: show whether an emulator/phone is connected.
  useEffect(() => {
    if (platform !== 'android') return
    api.devices().then(d => setDevices(d.devices)).catch(() => setDevices([]))
  }, [platform])

  function choose(p: Platform) {
    setIos(false)
    setPlatform(p)
    setError('')
    setReq(p === 'android' ? APP_EXAMPLE : WEB_EXAMPLES[0])
  }

  async function generate() {
    const target = platform === 'android' ? apk.trim() : url.trim()
    if (platform === 'web' && !isUrl(target)) return setError('Enter a full URL, like https://yourwebsite.com')
    if (platform === 'android' && !target.endsWith('.apk')) return setError('Enter the full path of an .apk file')
    if (req.trim().length < 20) return setError('Add a few more details about what to test.')
    setError('')
    setBusy(true)
    try {
      if (platform === 'android') {
        try {
          localStorage.setItem(APK_KEY, target)
        } catch {
          /* storage blocked — only a convenience */
        }
      }
      const t = { platform, url: target, viewport, clear_data: clearData }
      const plan = await api.plan(t, req)
      go({ name: 'plan', target: t, cases: plan.cases })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ph" style={{ marginBottom: 14 }}>
        <div>
          <h1>Create test run</h1>
          <div className="sub">Tell us what to test. You'll review the plan before anything runs.</div>
        </div>
      </div>
      <Steps current={1} />
      <div className="two">
      <div className="l card" style={{ position: 'relative' }}>
        <div className="cb" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, ...(busy ? { opacity: 0.4, pointerEvents: 'none' } : {}) }}>
          <div>
            <label className="lbl">What do you want to test?</label>
            <div className="seg" style={{ maxWidth: 540, whiteSpace: 'nowrap' }}>
              <button className={!ios && platform === 'web' ? 'on' : ''} onClick={() => choose('web')}><Icon name="globe" size={16} />Website</button>
              <button className={!ios && platform === 'android' ? 'on' : ''} onClick={() => choose('android')}><Icon name="mob" size={16} />Android app (APK)</button>
              <button className={ios ? 'on' : ''} onClick={() => { setIos(true); setError('') }}><Icon name="mob" size={16} />iOS app</button>
            </div>
          </div>

          {ios ? (
            <div style={{ border: '1.5px dashed var(--bd)', borderRadius: 14, background: 'var(--bg)', padding: '40px 24px', textAlign: 'center' }}>
              <div className="mk" style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: 14, background: 'var(--tint)', color: 'var(--prit)' }}><Icon name="mob" size={26} /></div>
              <div className="f6" style={{ fontSize: 20 }}>iOS app testing is coming soon</div>
              <div className="mut" style={{ maxWidth: 420, margin: '6px auto 18px' }}>Soon you'll test iPhone apps the same way as Android APKs. For now, test a website or an Android app.</div>
              <button className="btn" onClick={() => go({ name: 'soon' })}><Icon name="spark" size={16} />See what's coming</button>
            </div>
          ) : <>
          {platform === 'web' ? (
            <div>
              <label className="lbl">Website URL</label>
              <div className={`inp ${error ? 'er' : ''}`}>
                <Icon name="globe" size={16} />
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://yourwebsite.com" />
              </div>
              {error ? <div className="err">{error}</div> : <div className="hint">We'll open this page in a real browser. Demo shop: <button className="btn s g" onClick={() => setUrl(`${location.origin.replace(':5173', ':8000')}/demo/`)}>use demo shop</button></div>}
            </div>
          ) : (
            <div>
              <label className="lbl">APK file (path on this computer)</label>
              <div className={`inp ${error ? 'er' : ''}`}>
                <input value={apk} onChange={e => setApk(e.target.value)}
                  placeholder="/home/you/project/build/app/outputs/flutter-apk/app-release.apk" />
              </div>
              {error ? <div className="err">{error}</div> : (
                <div className="hint">
                  {devices === null ? 'Checking for a device…'
                    : devices.length ? `Device connected: ${devices[0]}. The APK is installed and opened on it.`
                      : <span className="red">No Android device found — start an emulator or plug in a phone with USB debugging.</span>}
                </div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button className={`tg ${clearData ? 'on' : ''}`} role="switch" aria-checked={clearData}
                  aria-label="Fresh app data" onClick={() => setClearData(!clearData)} />
                <span style={{ fontSize: 13 }}>Start every test with fresh app data (like a new install: onboarding, logged out)</span>
              </div>
            </div>
          )}

          <div>
            <label className="lbl">Testing requirements</label>
            <textarea value={req} maxLength={2000} onChange={e => setReq(e.target.value)} />
            <div className="row hint">
              {platform === 'web' && (
                <>
                  <span>Try an example:</span>
                  <button className="btn s g" onClick={() => setReq(WEB_EXAMPLES[0])}>Login</button>
                  <button className="btn s g" onClick={() => setReq(WEB_EXAMPLES[1])}>Checkout</button>
                </>
              )}
              <span className="sp">{req.length} / 2000</span>
            </div>
          </div>
          {platform === 'web' && (
            <div>
              <label className="lbl">Viewport</label>
              <div className="seg" style={{ maxWidth: 420 }}>
                {(Object.keys(VIEWPORTS) as Viewport[]).map(v => (
                  <button key={v} className={viewport === v ? 'on' : ''} onClick={() => setViewport(v)}>
                    <Icon name={({ Desktop: 'desk', Tablet: 'tab', Mobile: 'mob' } as Record<Viewport, IconName>)[v]} size={16} />{v}
                  </button>
                ))}
              </div>
              <div className="hint">{VIEWPORTS[viewport]} px</div>
            </div>
          )}
          </>}
          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 18 }}>
            <button className="btn" onClick={() => go({ name: 'dash' })}>Cancel</button>
            {!ios && (
              <button className="btn p sp" style={{ height: 42, padding: '0 20px' }} disabled={busy} onClick={generate}>
                <Icon name="spark" size={16} />Generate Test Plan
              </button>
            )}
          </div>
        </div>
        {busy && (
          <div className="card" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(400px,90%)', padding: 22, boxShadow: '0 14px 36px rgba(15,23,42,.18)' }}>
            <div className="f6" style={{ fontSize: 16 }}>Building your test plan</div>
            <div className="mut" style={{ fontSize: 13, marginBottom: 14 }}>
              {platform === 'android' ? 'Usually 20 to 60 seconds (longer the first time an APK is installed).' : 'Usually 10 to 20 seconds.'}
            </div>
            {PHASES[platform].map((t, i) => (
              <div key={t} className="row" style={{ marginBottom: 9, ...(i > phase ? { color: '#94A3B8' } : {}) }}>
                {i < phase ? <span style={{ color: '#16A34A' }}><Icon name="ok" /></span>
                  : i === phase ? <span className="spin" style={{ color: '#4F46E5' }}><Icon name="load" /></span>
                    : <span className="mut"><Icon name="clock" /></span>}
                {t}
              </div>
            ))}
            <div className="bar" style={{ marginTop: 12 }}><span style={{ width: `${((phase + 1) / (PHASES[platform].length + 1)) * 100}%`, background: 'var(--pri)' }} /></div>
          </div>
        )}
      </div>
      <div className="r">
        <div className="card cb" style={{ background: 'var(--bg)' }}>
          <div className="f6 row" style={{ marginBottom: 8, color: 'var(--prit)' }}><Icon name="spark" size={16} /><span style={{ color: 'var(--ink)' }}>Tips for better plans</span></div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div>Name the flows: login, checkout, search.</div>
            <div>Say what success looks like, like “order confirmation page appears”.</div>
            <div>Add test data if needed, like a discount code or a test account.</div>
            <div>On client or live systems add “Do not submit any forms”.</div>
            <div>Keep it to 3 to 5 flows; each test takes 20 to 60 seconds.</div>
          </div>
        </div>
      </div>
      </div>
    </>
  )
}
