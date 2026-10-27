import { useEffect, useState } from 'react'
import { api, VIEWPORTS, type Run } from '../api'
import type { Screen } from '../App'
import { fmtDate, toast } from '../components'
import { Icon } from '../icons'
import { bugMarkdown, download, observed } from '../report'

const SEVERITY = { Critical: 'bad', High: 'bad', Medium: 'warn', Low: 'neu' }
const CONFIDENCE = { High: 'ok', Medium: 'warn', Low: 'neu' }
const reviewedKey = (runId: number, caseId: number) => `testpilot.reviewed.${runId}.${caseId}`

// Network errors are stored as "METHOD URL STATUS" or "METHOD URL failed: reason".
function parseRequest(line: string) {
  const [method, url, ...rest] = line.split(' ')
  return { method, url, status: rest.join(' ') }
}

export default function BugReport({ runId, caseId, go }: { runId: number; caseId: number; go: (s: Screen) => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [reviewed, setReviewed] = useState(() => {
    try {
      return localStorage.getItem(reviewedKey(runId, caseId)) === '1'
    } catch {
      return false
    }
  })

  async function load(regenerate = false) {
    setBusy(true)
    setError('')
    try {
      await api.bug(runId, caseId, regenerate) // writes the report once, then it is saved with the run
      setRun(await api.run(runId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
  }, [runId, caseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const r = run?.results.find(x => x.case.id === caseId)
  const back = <button className="btn g s" style={{ marginBottom: 10, paddingLeft: 0 }} onClick={() => go({ name: 'run', runId })}><Icon name="back" size={14} />Back to run #{runId}</button>

  if (error) return <>{back}<div className="err">{error}</div></>
  if (!run || !r?.bug)
    return (
      <>
        {back}
        <div className="card cb" style={{ maxWidth: 520 }}>
          <div className="row"><span className="spin" style={{ color: 'var(--prit)' }}><Icon name="load" /></span><span className="f6">Writing the bug report…</span></div>
          <div className="mut" style={{ fontSize: 13, marginTop: 6 }}>Claude reads the log and errors of this test. Usually 10 to 20 seconds.</div>
        </div>
      </>
    )

  const b = r.bug
  const facts = observed(run, r)
  const requests = r.network_errors.map(parseRequest)
  const md = () => bugMarkdown(run, r)
  const toggleReviewed = () => {
    const next = !reviewed
    setReviewed(next)
    try {
      localStorage.setItem(reviewedKey(runId, caseId), next ? '1' : '0')
    } catch {
      /* per-browser convenience only */
    }
    toast(next ? 'Marked as reviewed' : 'Review removed')
  }

  return (
    <>
      {back}
      <div className="ph">
        <div style={{ maxWidth: 760 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`b ${SEVERITY[b.severity]}`}>{b.severity}</span>
            <span className="b ok">Confirmed failure</span>
            {r.attempts > 1 && <span className="b warn">Failed twice</span>}
            {reviewed && <span className="b ind">Reviewed</span>}
          </div>
          <h1>{b.title}</h1>
          <div className="sub">{run.url} · {fmtDate(run.created_at)} · {run.platform === 'android' ? 'Android' : `Chromium · ${VIEWPORTS[run.viewport]}`}</div>
        </div>
        <div className="row" style={{ position: 'relative' }}>
          <button className="btn" onClick={() => navigator.clipboard.writeText(md()).then(() => toast('Bug report copied as Markdown'))}>
            <Icon name="link" size={16} />Copy for Jira / Teams
          </button>
          <button className="btn p" onClick={() => setMenu(!menu)}><Icon name="dl" size={16} />Export<Icon name="cd" size={14} /></button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { download(`bug-run${run.id}-case${caseId}.md`, md()); setMenu(false) }}>Markdown file</button>
              <button onClick={() => { setMenu(false); setTimeout(() => window.print(), 50) }}>Print / Save as PDF</button>
            </div>
          )}
        </div>
      </div>

      <div className="two">
        <div className="l">
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="ch">Steps to reproduce</div>
            <div className="cb">
              {b.steps.map((s, i) => (
                <div key={i} className="row" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
                  <span className="b ind" style={{ width: 24, height: 24, justifyContent: 'center', padding: 0, flex: 'none' }}>{i + 1}</span>{s}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div className="card cb exp">
              <div className="f6" style={{ marginBottom: 4 }}>Expected</div>{b.expected}
            </div>
            <div className="card cb act">
              <div className="f6" style={{ marginBottom: 4 }}>Actual</div>{b.actual}
            </div>
          </div>
          <div className="card">
            <div className="ch">Evidence</div>
            <div className="cb">
              {r.screenshot && (
                <a href={r.screenshot} target="_blank" rel="noreferrer">
                  <img src={r.screenshot} alt="Screenshot at the end of the test"
                    style={{ width: run.platform === 'android' ? 320 : '100%', maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 14 }} />
                </a>
              )}
              {r.console_errors.length > 0 && (
                <>
                  <div className="f5 mut" style={{ fontSize: 12, marginBottom: 6 }}>{run.platform === 'android' ? 'App errors (logcat)' : 'Console errors'}</div>
                  <div className="code red" style={{ marginBottom: 14 }}>{r.console_errors.join('\n')}</div>
                </>
              )}
              {requests.length > 0 && (
                <>
                  <div className="f5 mut" style={{ fontSize: 12, marginBottom: 6 }}>Failed network requests</div>
                  <div className="card" style={{ overflow: 'auto', marginBottom: 14 }}>
                    <table><tbody>
                      {requests.map((q, i) => (
                        <tr key={i}>
                          <td className="f5">{q.method}</td>
                          <td style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13, whiteSpace: 'normal', wordBreak: 'break-all' }}>{q.url}</td>
                          <td><span className="b bad">{q.status}</span></td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                </>
              )}
              <div className="f5 mut" style={{ fontSize: 12, marginBottom: 6 }}>Execution log</div>
              <div className="code">{r.log.join('\n')}</div>
            </div>
          </div>
        </div>

        <div className="r">
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="ch" style={{ color: '#4ADE80' }}>Confirmed evidence</div>
            <div className="cb" style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="mut" style={{ fontSize: 12 }}>Observed directly during the run.</div>
              {(facts.length ? facts : ['The expected result did not appear (see screenshot and verdict).']).map((t, i) => (
                <div key={i} className="row" style={{ alignItems: 'flex-start', color: '#16A34A' }}>
                  <Icon name="check" size={16} /><span style={{ color: 'var(--ink)', wordBreak: 'break-word' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{ border: '1.5px dashed var(--tintb)', background: 'var(--tint)', marginBottom: 14 }}>
            <div className="ch" style={{ borderColor: 'var(--tintb)' }}>
              <span className="row"><Icon name="spark" size={16} />AI analysis</span>
              <span className="b ind" style={{ background: 'var(--card)' }}>Not confirmed</span>
            </div>
            <div className="cb" style={{ fontSize: 13 }}>
              <div className="f6" style={{ marginBottom: 3 }}>Likely cause</div>{b.likely_cause}
              <div className="f6" style={{ margin: '12px 0 3px' }}>Worth checking</div>
              {b.worth_checking.map((w, i) => <div key={i}>• {w}</div>)}
              <div className="row" style={{ borderTop: '1px solid var(--tintb)', marginTop: 12, paddingTop: 10 }}>
                <span className="mut">Confidence</span><span className={`b ${CONFIDENCE[b.confidence]} sp`}>{b.confidence}</span>
              </div>
            </div>
          </div>
          <button className="btn" style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }} onClick={toggleReviewed}>
            <Icon name="check" size={16} />{reviewed ? 'Reviewed' : 'Mark as reviewed'}
          </button>
          <button className="btn g" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={() => load(true)}>
            {busy ? 'Rewriting…' : 'Rewrite with AI'}
          </button>
        </div>
      </div>
    </>
  )
}
