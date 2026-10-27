import { useState } from 'react'
import { api, VIEWPORTS, type Target, type TestCase } from '../api'
import type { Screen } from '../App'
import { CaseEditor, cleanCase, host, Steps, toast } from '../components'
import { Icon } from '../icons'

const PRIORITY_CLASS = { High: 'bad', Medium: 'warn', Low: 'neu' }

interface Props {
  target: Target
  cases: TestCase[]
  go: (s: Screen) => void
}

export default function PlanReview({ target, cases: initial, go }: Props) {
  const [cases, setCases] = useState(initial)
  const [selected, setSelected] = useState<Set<number>>(new Set(initial.map(c => c.id)))
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (id: number) =>
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const update = (id: number, patch: Partial<TestCase>) =>
    setCases(cs => cs.map(c => (c.id === id ? { ...c, ...patch } : c)))
  const remove = (c: TestCase) => {
    const at = cases.findIndex(x => x.id === c.id)
    setCases(cs => cs.filter(x => x.id !== c.id))
    toast('Test case removed', { label: 'Undo', run: () => setCases(cs => [...cs.slice(0, at), c, ...cs.slice(at)]) })
  }
  const allOn = cases.length > 0 && cases.every(c => selected.has(c.id))
  const count = (p: TestCase['priority']) => cases.filter(c => selected.has(c.id) && c.priority === p).length
  const addCase = () => {
    const id = Math.max(0, ...cases.map(c => c.id)) + 1
    setCases(cs => [...cs, { id, title: '', priority: 'Medium', steps: [''], expected: '' }])
    setSelected(s => new Set(s).add(id))
    setEditing(id)
  }

  async function approve() {
    const chosen = cases.filter(c => selected.has(c.id)).map(cleanCase)
    if (!chosen.length) return setError('Select at least one test case to run.')
    if (chosen.some(c => !c.title.trim() || !c.steps.length || !c.expected.trim()))
      return setError('Every selected test case needs a title, at least one step and an expected result.')
    setBusy(true)
    try {
      const run = await api.startRun(target, chosen)
      go({ name: 'run', runId: run.id })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ph" style={{ marginBottom: 14 }}>
        <div>
          <h1>Review test plan</h1>
          <div className="sub">AI drafted {cases.length} test cases for {host(target.url)}. Nothing runs until you approve.</div>
        </div>
      </div>
      <Steps current={2} />
      <div className="two">
        <div className="l">
          <div className="row" style={{ marginBottom: 12 }}>
            <div className={`cbx ${allOn ? 'on' : ''}`} onClick={() => setSelected(allOn ? new Set() : new Set(cases.map(c => c.id)))}>
              {allOn ? <Icon name="check" size={14} /> : ''}
            </div>
            <span className="f5">{cases.filter(c => selected.has(c.id)).length} of {cases.length} selected</span>
          </div>
          {cases.map(c => (
            <div key={c.id} className={`cs ${editing === c.id ? 'ed' : ''}`}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div className={`cbx ${selected.has(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
                  {selected.has(c.id) ? <Icon name="check" size={14} /> : ''}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editing === c.id ? (
                    <CaseEditor value={c} onChange={next => update(c.id, next)} />
                  ) : (
                    <>
                      <div className="row" style={{ flexWrap: 'wrap' }}>
                        <span className="f6" style={{ fontSize: 15 }}>{c.title}</span>
                        <span className={`b ${PRIORITY_CLASS[c.priority]}`}>{c.priority} priority</span>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        {c.steps.map((s, i) => (
                          <div key={i} className="row"><span className="mut" style={{ width: 18 }}>{i + 1}.</span>{s}</div>
                        ))}
                      </div>
                      <div className="mut" style={{ fontSize: 13, marginTop: 6 }}>Expected: {c.expected}</div>
                    </>
                  )}
                </div>
                <button className="btn g s" aria-label="Edit" style={{ color: 'var(--mut)' }} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                  {editing === c.id ? 'Done' : <Icon name="edit" size={16} />}
                </button>
                <button className="btn g s" aria-label="Delete" style={{ color: 'var(--mut)' }} onClick={() => remove(c)}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          ))}
          <button className="btn" style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }} onClick={addCase}>
            + Add test case
          </button>
        </div>
        <div className="r">
          <div className="card cb" style={{ marginBottom: 14 }}>
            <div className="f6" style={{ marginBottom: 10 }}>Run summary</div>
            {[...(target.platform === 'android'
              ? [['App', host(target.url)], ['Device', 'Android (adb)'], ['Fresh app data', target.clear_data ? 'Yes' : 'No']]
              : [['Website', host(target.url)], ['Browser', 'Chromium'], ['Viewport', VIEWPORTS[target.viewport]]]),
              ['Test cases', `${cases.filter(c => selected.has(c.id)).length} selected`]].map(([k, v]) => (
              <div key={k} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="mut">{k}</span><span className="f5 sp">{v}</span>
              </div>
            ))}
            <div className="row" style={{ marginTop: 12 }}>
              <span className="b bad">{count('High')} High</span><span className="b warn">{count('Medium')} Medium</span><span className="b neu">{count('Low')} Low</span>
            </div>
          </div>
          <div className="card cb" style={{ background: 'var(--bg)', fontSize: 13, marginBottom: 14 }}>
            Tests run in a real {target.platform === 'android' ? 'Android device' : 'Chromium browser'}. Results come from the actual run, not from AI.
          </div>
          {error && <div className="err" style={{ marginBottom: 8 }}>{error}</div>}
          <button className="btn p" style={{ width: '100%', justifyContent: 'center', height: 44, marginBottom: 8 }}
            disabled={busy} onClick={approve}>
            <Icon name="play" size={16} />{busy ? 'Starting…' : 'Approve & Run Tests'}
          </button>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => go({ name: 'new', prefill: target })}>
            <Icon name="back" size={16} />Edit Requirements
          </button>
        </div>
      </div>
    </>
  )
}
