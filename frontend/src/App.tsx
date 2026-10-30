import { useEffect, useState } from 'react'
import { api, getApiKey, NEED_ACCESS, NEED_KEY, type Target, type TestCase } from './api'
import { AccessScreen, CommandPalette, KeyDialog, Toasts } from './components'
import { Icon, type IconName } from './icons'
import Admin from './pages/Admin'
import BugReport from './pages/BugReport'
import ComingSoon from './pages/ComingSoon'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import NewRun from './pages/NewRun'
import PlanReview from './pages/PlanReview'
import RunView from './pages/RunView'
import Settings from './pages/Settings'

// Simple screen switcher (no router): dashboard, new → plan → run → bug, history, settings.
export type Screen =
  | { name: 'dash' }
  | { name: 'new'; prefill?: Partial<Target> }
  | { name: 'plan'; target: Target; cases: TestCase[] }
  | { name: 'run'; runId: number }
  | { name: 'bug'; runId: number; caseId: number }
  | { name: 'history'; filter?: string }
  | { name: 'settings' }
  | { name: 'soon' }

const NAV: [Screen['name'], string, IconName][] = [
  ['dash', 'Dashboard', 'grid'],
  ['new', 'New Test Run', 'plus'],
  ['history', 'Test History', 'clock'],
  ['settings', 'Settings', 'sliders'],
  ['soon', 'Coming Soon', 'spark'],
]
// Which sidebar item is highlighted for each screen.
const ACTIVE: Record<Screen['name'], Screen['name']> = {
  dash: 'dash', new: 'new', plan: 'new', run: 'new', bug: 'history', history: 'history', settings: 'settings', soon: 'soon',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'dash' })
  const [mini, setMini] = useState(false)
  const [palette, setPalette] = useState(false)
  const [needsKey, setNeedsKey] = useState(false) // public deploy: every tester brings their own key
  const [keyDialog, setKeyDialog] = useState(false)
  // Hosted version: null = still checking, '' = needs an access code, else the code's label.
  const [access, setAccess] = useState<string | null>(null)
  const [hosted, setHosted] = useState(false)
  const [light, setLight] = useState(document.documentElement.dataset.theme === 'light')

  function toggleTheme() {
    const next = !light
    setLight(next)
    if (next) document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem('testpilot.theme', next ? 'light' : 'dark')
    } catch {
      /* storage blocked — theme just isn't remembered */
    }
  }

  const go = (s: Screen) => {
    setScreen(s)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(p => !p)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    api.health().then(async h => {
      setNeedsKey(h.needs_key)
      setHosted(h.public)
      const label = h.public ? await api.me().then(m => m.label ?? '').catch(() => '') : 'local'
      setAccess(label)
      if (label && h.needs_key && !getApiKey()) setKeyDialog(true)
    }).catch(() => setAccess('local'))
    const onNeedKey = () => setKeyDialog(true)
    const onNeedAccess = () => setAccess('')
    window.addEventListener(NEED_KEY, onNeedKey)
    window.addEventListener(NEED_ACCESS, onNeedAccess)
    return () => {
      window.removeEventListener(NEED_KEY, onNeedKey)
      window.removeEventListener(NEED_ACCESS, onNeedAccess)
    }
  }, [])

  if (location.hash === '#admin') return <><Admin /><Toasts /></>
  if (access === null) return null
  if (access === '') {
    return <AccessScreen done={label => { setAccess(label); if (needsKey && !getApiKey()) setKeyDialog(true) }} />
  }

  return (
    <div id="app" className={mini ? 'mini' : ''}>
      <aside>
        <div className="logo">
          <div className="mk"><Icon name="rocket" /></div>
          <span className="tx">Testara</span>
        </div>
        <button className="srch" onClick={() => setPalette(true)}>
          <Icon name="search" size={16} /><span className="tx">Search</span><kbd className="tx">Ctrl K</kbd>
        </button>
        {NAV.map(([name, label, icon]) => (
          <button key={name} className={`nav ${ACTIVE[screen.name] === name ? 'on' : ''}`} onClick={() => go({ name } as Screen)}>
            <Icon name={icon} /><span className="tx">{label}</span>
          </button>
        ))}
        <button className="nav" onClick={() => setKeyDialog(true)}>
          <Icon name="key" /><span className="tx">{getApiKey() ? 'API key added' : 'Add API key'}</span>
        </button>
        <button className="thm" onClick={toggleTheme} aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}>
          <Icon name={light ? 'moon' : 'sun'} /><span className="tx">{light ? 'Dark mode' : 'Light mode'}</span>
        </button>
        <button className="nav" style={{ marginTop: 8 }} onClick={() => setMini(!mini)}>
          <Icon name="panel" /><span className="tx">{mini ? 'Expand' : 'Collapse'}</span>
        </button>
        <div className="me">
          <div className="av">QA</div>
          <div className="tx">
            <div className="f5" style={{ fontSize: 13 }}>{hosted ? access : 'QA workspace'}</div>
            {hosted
              ? <button className="btn s g" style={{ fontSize: 12, padding: 0, height: 'auto' }}
                  onClick={() => api.logout().finally(() => setAccess(''))}>Sign out</button>
              : <div className="mut" style={{ fontSize: 12 }}>Runs on this computer</div>}
          </div>
        </div>
      </aside>
      <main key={screen.name === 'run' ? `run${screen.runId}` : screen.name}>
        {screen.name === 'dash' && <Dashboard go={go} />}
        {screen.name === 'new' && <NewRun go={go} prefill={screen.prefill} />}
        {screen.name === 'plan' && <PlanReview {...screen} go={go} />}
        {screen.name === 'run' && <RunView runId={screen.runId} go={go} />}
        {screen.name === 'bug' && <BugReport runId={screen.runId} caseId={screen.caseId} go={go} />}
        {screen.name === 'history' && <History go={go} initialFilter={screen.filter} />}
        {screen.name === 'settings' && <Settings />}
        {screen.name === 'soon' && <ComingSoon go={go} />}
      </main>
      <Toasts />
      {palette && <CommandPalette go={go} close={() => setPalette(false)} />}
      {keyDialog && <KeyDialog required={needsKey && !getApiKey()} close={() => setKeyDialog(false)} />}
    </div>
  )
}
