import { useEffect, useState } from 'react'
import { api, VIEWPORTS, type Run, type Status, type TestCase } from '../api'
import type { Screen } from '../App'
import { Badge, CaseEditor, cleanCase, fmtDate, host, QuestionDialog, Steps, toast } from '../components'
import { Icon } from '../icons'
import { download, runMarkdown } from '../report'

const POLL_MS = 1500

function StatusIcon({ status }: { status: Status }) {
  if (status === 'Passed') return <span style={{ color: '#16A34A' }}><Icon name="ok" /></span>
  if (status === 'Failed') return <span style={{ color: '#DC2626' }}><Icon name="no" /></span>
  if (status === 'Running') return <span className="spin" style={{ color: '#4F46E5' }}><Icon name="load" /></span>
  if (status === 'Queued') return <span className="mut"><Icon name="clock" /></span>
  return <span style={{ color: '#D97706' }}><Icon name="ban" /></span>
}

export default function RunView({ runId, go }: { runId: number; go: (s: Screen) => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [draft, setDraft] = useState<TestCase | null>(null) // test case being edited for a re-run
  const [starting, setStarting] = useState(false)
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState('')
  const [answered, setAnswered] = useState<string | null>(null) // hides the dialog until the next poll

  // Poll while the backend is still running tests; toast once when it finishes.
  useEffect(() => {
    let timer: number | undefined
    let wasRunning = false
    const load = async () => {
      try {
        const r = await api.run(runId)
        setRun(r)
        if (r.status === 'Running') {
          wasRunning = true
          timer = window.setTimeout(load, POLL_MS)
        } else if (wasRunning) {
          toast(`Run #${r.id} complete: ${r.status}`)
        }
      } catch (e) {
        setError((e as Error).message)
      }
    }
    load()
    return () => window.clearTimeout(timer)
  }, [runId])

  if (error) return <div className="err">{error}</div>
  if (!run) return <div className="sk" style={{ height: 300 }} />

  const n = run.results.length
  const count = (s: Status) => run.results.filter(r => r.status === s).length
  const done = count('Passed') + count('Failed') + count('Blocked')
  const live = run.status === 'Running'
  // Follow the running test while live; afterwards show the first failure unless the user picked one.
  const auto = live ? run.results.findIndex(r => r.status === 'Running') : run.results.findIndex(r => r.status === 'Failed')
  const idx = sel ?? Math.max(0, auto)
  const t = run.results[idx]
  const notPassed = run.results.filter(r => r.status === 'Failed' || r.status === 'Blocked')
  const firstIssue = run.results.findIndex(r => r.status === 'Failed' || r.status === 'Blocked')
  const waiting = run.results.find(r => r.question && r.question.answer === null)
  const questionKey = waiting ? `${waiting.case.id}:${waiting.question!.asked_at}` : null
  document.title = waiting ? '(?) Answer needed · TestPilot AI' : 'TestPilot AI'

  // A re-run is a new run on the same target, so the old result stays in history.
  async function rerun(cases: TestCase[]) {
    setStarting(true)
    try {
      const { platform, url, viewport, clear_data } = run!
      const next = await api.startRun({ platform, url, viewport, clear_data }, cases.map(cleanCase))
      go({ name: 'run', runId: next.id })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <Steps current={3} />
      {waiting && questionKey !== answered && (
        <QuestionDialog runId={run.id} caseId={waiting.case.id} title={waiting.case.title} q={waiting.question!}
          done={() => setAnswered(questionKey)} />
      )}
      <div className="ph">
        <div>
          <div className="row">
            <h1>{host(run.url)}</h1>
            {live ? <span className="b d ind">Running…</span> : <Badge status={run.status} />}
          </div>
          <div className="sub">Run #{run.id} · {run.platform === 'android' ? 'Android' : `Chromium · ${VIEWPORTS[run.viewport]}`} · {fmtDate(run.created_at)}</div>
        </div>
        <div className="row" style={{ position: 'relative' }}>
          {!live && notPassed.length > 0 && (
            <button className="btn" disabled={starting} onClick={() => rerun(notPassed.map(r => r.case))}>
              <Icon name="play" size={16} />{starting ? 'Starting…' : `Re-run ${notPassed.length} failed / blocked`}
            </button>
          )}
          <button className="btn" onClick={() => (firstIssue < 0 ? toast('No failures to inspect.') : (setSel(firstIssue), setDraft(null)))}>
            <Icon name="file" size={16} />Inspect evidence
          </button>
          <button className="btn p" disabled={live} onClick={() => setMenu(!menu)}><Icon name="dl" size={16} />Export report<Icon name="cd" size={14} /></button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { download(`test-run-${run.id}.md`, runMarkdown(run)); setMenu(false) }}>Markdown file</button>
              <button onClick={() => { navigator.clipboard.writeText(runMarkdown(run)).then(() => toast('Report copied')); setMenu(false) }}>Copy as Markdown</button>
              <button onClick={() => { setMenu(false); setTimeout(() => window.print(), 50) }}>Print / Save as PDF</button>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '14px 18px', marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="f5">{done} of {n} tests executed</span>
          <span className="mut sp">{live ? 'Running in a real ' + (run.platform === 'android' ? 'Android device' : 'browser') : `Pass rate ${Math.round((count('Passed') / n) * 100)}%`}</span>
        </div>
        <div className="bar" style={{ height: 8, display: 'flex' }}>
          <span style={{ width: `${(count('Passed') / n) * 100}%`, background: '#16A34A', borderRadius: 0 }} />
          <span style={{ width: `${(count('Failed') / n) * 100}%`, background: '#DC2626', borderRadius: 0 }} />
          <span style={{ width: `${(count('Blocked') / n) * 100}%`, background: '#F59E0B', borderRadius: 0 }} />
        </div>
      </div>
      <div className="g4" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        {([['Passed', '#16A34A'], ['Failed', '#DC2626'], ['Blocked', '#D97706']] as [Status, string][]).map(([s, c]) => (
          <div key={s} className="card kpi" style={{ cursor: 'default' }}><div className="l">{s}</div><div className="n" style={{ color: c }}>{count(s)}</div></div>
        ))}
      </div>

      <div className="two">
        <div className="card" style={{ flex: 1.1, minWidth: 0 }}>
          <div className="ch">Test cases<span className="mut" style={{ fontWeight: 400, fontSize: 13 }}>{n} total</span></div>
          <table><tbody>
            {run.results.map((r, i) => (
              <tr key={r.case.id} className={`r ${i === idx ? 'sel' : ''}`} onClick={() => { setSel(i); setDraft(null) }}>
                <td className="mut" style={{ width: 30, paddingRight: 0 }}>{i + 1}</td>
                <td className="f5" style={{ whiteSpace: 'normal' }}>{r.case.title}</td>
                <td><span className="row"><StatusIcon status={r.status} />{r.question && r.question.answer === null ? 'Waiting for you' : r.status}</span></td>
                <td className="mut" style={{ textAlign: 'right' }}>{r.duration_s ? `${r.duration_s}s` : '-'}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="ch"><span>{t.case.title}</span>{['Passed', 'Failed', 'Blocked'].includes(t.status) && <Badge status={t.status} />}</div>
            <div className="cb">
              {draft ? (
                <div style={{ marginBottom: 14 }}>
                  <CaseEditor value={draft} onChange={setDraft} />
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                    <button className="btn s" onClick={() => setDraft(null)}>Cancel</button>
                    <button className="btn s p" disabled={starting} onClick={() => rerun([draft])}>
                      {starting ? 'Starting…' : 'Save & re-run this test'}
                    </button>
                  </div>
                </div>
              ) : (
                !live && (
                  <div className="row" style={{ marginBottom: 12 }}>
                    <span className="mut" style={{ fontSize: 13 }}>Wrong steps or expected result?</span>
                    <button className="btn s sp" onClick={() => setDraft(t.case)}><Icon name="edit" size={14} />Edit &amp; re-run</button>
                  </div>
                )
              )}
              {t.reason && (
                <div style={{ marginBottom: 12, fontSize: 13 }}>
                  <span className="f6">Verdict: </span>{t.reason}
                  {t.attempts > 1 && <span className="b warn" style={{ marginLeft: 6 }}>Ran twice</span>}
                </div>
              )}
              {t.screenshot && (
                <>
                  <div className="f5 mut" style={{ fontSize: 12, marginBottom: 6 }}>Screenshot at the end of the test</div>
                  <a href={t.screenshot} target="_blank" rel="noreferrer">
                    <img src={t.screenshot} alt="" style={{ width: run.platform === 'android' ? 260 : '100%', maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 8 }} />
                  </a>
                </>
              )}
              <div className="f5 mut" style={{ fontSize: 12, margin: '12px 0 6px' }}>Execution log</div>
              <div className="code">{t.log.join('\n') || (t.status === 'Running' ? 'Running…' : 'Waiting to run…')}</div>
              {(t.console_errors.length > 0 || t.network_errors.length > 0) && (
                <>
                  <div className="f5 mut" style={{ fontSize: 12, margin: '12px 0 6px' }}>{run.platform === 'android' ? 'App errors (logcat)' : <>Console &amp; network errors</>}</div>
                  <div className="code red">{[...t.console_errors, ...t.network_errors].join('\n')}</div>
                </>
              )}
              {t.status === 'Failed' && !live && (
                <button className="btn s p" style={{ marginTop: 12 }} onClick={() => go({ name: 'bug', runId: run.id, caseId: t.case.id })}>
                  <Icon name="alert" size={14} />{t.bug ? 'Open bug report' : 'Create bug report'}
                </button>
              )}
            </div>
          </div>
          {!live && (
            <div className="card" style={{ borderColor: 'var(--tintb)', background: 'var(--tint)' }}>
              <div className="cb">
                <div className="row" style={{ marginBottom: 6, color: 'var(--prit)' }}><Icon name="spark" size={16} /><span className="f6">Summary</span></div>
                <div style={{ fontSize: 13 }}>
                  {count('Failed') ? `${count('Failed')} test${count('Failed') > 1 ? 's' : ''} failed. Open a failing test for its evidence and create a bug report.`
                    : count('Blocked') ? `${count('Blocked')} test${count('Blocked') > 1 ? 's' : ''} could not finish. Check the verdict, then edit the steps or expected result and re-run.`
                      : 'All tests passed.'}
                </div>
                <div className="mut" style={{ fontSize: 12, marginTop: 8 }}>Results come from the real {run.platform === 'android' ? 'device' : 'browser'}: a pass needs text that is really on the screen.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
