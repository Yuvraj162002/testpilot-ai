import { useEffect, useMemo, useRef, useState } from 'react'
import { api, getApiKey, setApiKey, type Priority, type Question, type RunStatus, type RunSummary, type Status, type TestCase } from './api'
import type { Screen } from './App'
import { Icon, type IconName } from './icons'

export const STATUS_CLASS: Record<string, string> = {
  Passed: 'ok',
  Failed: 'bad',
  Blocked: 'warn',
  'Needs review': 'warn',
  Running: 'ind',
  Queued: 'neu',
}

export function Badge({ status }: { status: Status | RunStatus }) {
  return <span className={`b d ${STATUS_CLASS[status]}`}>{status}</span>
}

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ['Requirements', 'Review plan', 'Run & report']
  return (
    <div className="steps">
      {labels.map((label, i) => (
        <div key={label} style={{ display: 'contents' }}>
          <div className={`st ${i + 1 < current ? 'dn' : i + 1 === current ? 'on' : ''}`}>
            <i>{i + 1 < current ? '✓' : i + 1}</i>
            {label}
          </div>
          {i < labels.length - 1 && <div className="ln" />}
        </div>
      ))}
    </div>
  )
}

// Short name of a target: the site's host, or the APK file name.
export const host = (url: string) =>
  url.endsWith('.apk') ? url.split('/').pop()! : url.replace(/^https?:\/\//, '').split('/')[0]

// Edit one test case: title, priority, steps (one per line) and expected result.
export function CaseEditor({ value, onChange }: { value: TestCase; onChange: (c: TestCase) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label className="lbl">Title</label>
        <div className="inp"><input value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} /></div>
      </div>
      <div>
        <label className="lbl">Priority</label>
        <div className="seg" style={{ maxWidth: 300 }}>
          {(['High', 'Medium', 'Low'] as Priority[]).map(p => (
            <button key={p} className={value.priority === p ? 'on' : ''} onClick={() => onChange({ ...value, priority: p })}>{p}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="lbl">Steps (one per line)</label>
        <textarea style={{ minHeight: 100 }} value={value.steps.join('\n')}
          onChange={e => onChange({ ...value, steps: e.target.value.split('\n') })} />
      </div>
      <div>
        <label className="lbl">Expected result</label>
        <textarea style={{ minHeight: 70 }} value={value.expected}
          onChange={e => onChange({ ...value, expected: e.target.value })} />
      </div>
    </div>
  )
}

// Drop the empty lines the steps textarea leaves behind.
export const cleanCase = (c: TestCase): TestCase => ({ ...c, steps: c.steps.map(s => s.trim()).filter(Boolean) })

// ---------- run maths shared by dashboard, history, palette ----------

export const passRate = (r: { passed: number; failed: number; blocked: number }) => {
  const total = r.passed + r.failed + r.blocked
  return total ? Math.round((r.passed / total) * 100) : 0
}
export const rateColor = (p: number) => (p >= 90 ? '#16A34A' : p >= 75 ? '#D97706' : '#DC2626')
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function RateBar({ run }: { run: RunSummary }) {
  const p = passRate(run)
  return (
    <div className="row">
      <div className="bar" style={{ width: 80 }}><span style={{ width: `${p}%`, background: rateColor(p) }} /></div>
      <span className="f5">{p}%</span>
    </div>
  )
}

export function RunRow({ run, open }: { run: RunSummary; open: () => void }) {
  return (
    <tr className="r" onClick={open}>
      <td className="f5">
        <span className="row"><span className="mut"><Icon name={run.platform === 'android' ? 'mob' : 'globe'} size={15} /></span>{host(run.url)}</span>
      </td>
      <td><Badge status={run.status} /></td>
      <td className="mut">{fmtDate(run.created_at)}</td>
      <td>{run.status === 'Running' ? '–' : <RateBar run={run} />}</td>
      <td><Icon name="cr" size={16} /></td>
    </tr>
  )
}

// Small line chart used on the KPI cards.
export function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const w = 70, h = 26, max = Math.max(...data), min = Math.min(...data)
  const pts = data.map((v, i) => `${(i * w) / (data.length - 1)},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`)
  return (
    <svg width={w} height={h} style={{ marginTop: 4 }}>
      <polyline fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" points={pts.join(' ')} />
    </svg>
  )
}

// ---------- toasts ----------

type ToastItem = { id: number; text: string; action?: { label: string; run: () => void } }
let pushToast: ((t: ToastItem) => void) | null = null
let toastId = 0

export function toast(text: string, action?: ToastItem['action']) {
  pushToast?.({ id: ++toastId, text, action })
}

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    pushToast = t => {
      setItems(xs => [...xs, t])
      setTimeout(() => setItems(xs => xs.filter(x => x.id !== t.id)), 4200)
    }
    return () => { pushToast = null }
  }, [])
  return (
    <div id="toast">
      {items.map(t => (
        <div key={t.id} className="tt">
          <span>{t.text}</span>
          {t.action && (
            <button onClick={() => { t.action!.run(); setItems(xs => xs.filter(x => x.id !== t.id)) }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------- Ctrl+K command palette ----------

export function CommandPalette({ go, close }: { go: (s: Screen) => void; close: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    api.runs().then(setRuns).catch(() => setRuns([]))
  }, [])

  const items = useMemo(() => {
    const base: [string, IconName, Screen][] = [
      ['Go to Dashboard', 'grid', { name: 'dash' }],
      ['New Test Run', 'plus', { name: 'new' }],
      ['Test History', 'clock', { name: 'history' }],
      ['Settings', 'sliders', { name: 'settings' }],
      ...runs.map(r => [`Run #${r.id} · ${host(r.url)} · ${r.status}`, 'search', { name: 'run', runId: r.id }] as [string, IconName, Screen]),
    ]
    return base.filter(x => x[0].toLowerCase().includes(q.toLowerCase())).slice(0, 8)
  }, [q, runs])

  const pick = (n: number) => {
    if (items[n]) {
      go(items[n][2])
      close()
    }
  }

  return (
    <div id="cmd" className="on" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="cp">
        <input ref={input} value={q} placeholder="Type a command or search runs…" autoComplete="off"
          onChange={e => { setQ(e.target.value); setI(0) }}
          onKeyDown={e => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(items.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)) }
            else if (e.key === 'Enter') pick(i)
          }} />
        <div>
          {items.length ? items.map((x, n) => (
            <div key={x[0]} className={`ci ${n === i ? 'on' : ''}`} onMouseEnter={() => setI(n)} onClick={() => pick(n)}>
              <Icon name={x[1]} size={16} />{x[0]}
            </div>
          )) : <div className="ci mut">No results</div>}
        </div>
      </div>
    </div>
  )
}

// ---------- question from a running test ----------

export function QuestionDialog({ runId, caseId, title, q, done }: {
  runId: number; caseId: number; title: string; q: Question; done: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  // "Other / I'll type it" style options open the text box instead of being sent as the answer.
  const isOther = (o: string) => /^(other|something else)\b|type it|i'?ll type/i.test(o)

  async function send(answer: string, skip = false) {
    setBusy(true)
    try {
      await api.answer(runId, caseId, answer, skip)
      toast(skip ? 'Test skipped' : 'Answer sent, the test continues')
      done()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div id="cmd" className="on" style={{ paddingTop: '6vh' }}>
      <div className="cp" style={{ width: 'min(640px,94vw)', maxHeight: '88vh', overflow: 'auto' }}>
        <div className="cb">
          <div className="row" style={{ marginBottom: 4, color: 'var(--prit)' }}>
            <Icon name="spark" size={16} /><span className="f6">The test needs your answer</span>
            <span className="b warn sp">Paused</span>
          </div>
          <div className="mut" style={{ fontSize: 12, marginBottom: 12 }}>{title}</div>
          <div className="f6" style={{ fontSize: 17, marginBottom: 6 }}>{q.question}</div>
          {q.why && <div style={{ fontSize: 13, marginBottom: 12 }}>{q.why}</div>}
          {q.screenshot && (
            <a href={q.screenshot} target="_blank" rel="noreferrer">
              <img src={q.screenshot} alt="Current screen" style={{ maxWidth: '100%', maxHeight: 320, border: '1px solid var(--line)', borderRadius: 8, marginBottom: 12, display: 'block' }} />
            </a>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.options.map(o => (
              <button key={o} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', minHeight: 38, padding: '8px 14px', whiteSpace: 'normal', textAlign: 'left' }}
                disabled={busy} onClick={() => (isOther(o) ? input.current?.focus() : send(o))}>{o}</button>
            ))}
          </div>
          <label className="lbl" style={{ marginTop: 14 }}>Or type your own answer</label>
          <div className="row">
            <div className="inp">
              <input ref={input} value={text} placeholder="e.g. use test account qa@example.com / Test1234" onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && text.trim() && send(text.trim())} />
            </div>
            <button className="btn p" disabled={busy || !text.trim()} onClick={() => send(text.trim())}>Send</button>
          </div>
          {error && <div className="err">{error}</div>}
          <div className="row" style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
            <span className="mut" style={{ fontSize: 12 }}>The test waits up to 15 minutes, then it is skipped.</span>
            <button className="btn s sp" disabled={busy} onClick={() => send('skip', true)}>Skip this test</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- tester's own Anthropic API key ----------

export function KeyDialog({ required, close }: { required: boolean; close: () => void }) {
  const [key, setKey] = useState(getApiKey())
  const [show, setShow] = useState(false)
  const valid = key.trim().startsWith('sk-ant-')

  function save() {
    setApiKey(key)
    toast('API key added for this tab')
    close()
  }

  return (
    <div id="cmd" className="on" style={{ paddingTop: '12vh' }}
      onMouseDown={e => !required && e.target === e.currentTarget && close()}>
      <div className="cp" style={{ width: 'min(520px,94vw)' }}>
        <div className="cb">
          <div className="row" style={{ marginBottom: 8, color: 'var(--prit)' }}>
            <Icon name="key" size={16} /><span className="f6">Your Anthropic API key</span>
          </div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            TestPilot uses your own key to write plans, drive the browser and write bug reports. Usage is billed
            to your Anthropic account.
          </div>
          <div className="row">
            <div className="inp">
              <input type={show ? 'text' : 'password'} value={key} placeholder="sk-ant-…" autoComplete="off" autoFocus
                spellCheck={false} onChange={e => setKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && valid && save()} />
            </div>
            <button className="btn s" title={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}><Icon name="eye" size={16} /></button>
          </div>
          {key && !valid && <div className="err">An Anthropic key starts with sk-ant-</div>}
          <div className="mut" style={{ fontSize: 12, marginTop: 10 }}>
            Kept only in this browser tab&apos;s memory and sent with each request. Never saved on the server or in
            the browser; reloading the page forgets it.
          </div>
          <div className="row" style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
            {getApiKey() && <button className="btn s" onClick={() => { setApiKey(''); setKey(''); toast('API key removed') }}>Remove key</button>}
            {!required && <button className="btn s sp" onClick={close}>Cancel</button>}
            <button className={`btn p ${required ? 'sp' : ''}`} disabled={!valid} onClick={save}>Use this key</button>
          </div>
        </div>
      </div>
    </div>
  )
}
