import { useEffect, useMemo, useState } from 'react'
import { api, type RunSummary } from '../api'
import type { Screen } from '../App'
import { Badge, CountUp, host, passRate, RunRow, Spark } from '../components'
import { Icon, type IconName } from '../icons'

const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const
type Range = keyof typeof RANGES
const DAY = 86400000

// Pass rate per day over the range (days without runs are skipped).
function trend(runs: RunSummary[], days: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const points: { day: Date; rate: number; runs: number }[] = []
  for (let d = days - 1; d >= 0; d--) {
    const start = today.getTime() - d * DAY
    const inDay = runs.filter(r => {
      const t = new Date(r.created_at).getTime()
      return t >= start && t < start + DAY && r.status !== 'Running'
    })
    if (inDay.length)
      points.push({ day: new Date(start), rate: Math.round(inDay.reduce((s, r) => s + passRate(r), 0) / inDay.length), runs: inDay.length })
  }
  return points
}

// Runs per bucket for the small sparklines on the KPI cards.
function buckets(runs: RunSummary[], days: number, keep: (r: RunSummary) => boolean) {
  const n = 7, size = (days * DAY) / n, end = Date.now()
  return Array.from({ length: n }, (_, i) => runs.filter(r => {
    const t = new Date(r.created_at).getTime()
    return keep(r) && t >= end - (n - i) * size && t < end - (n - i - 1) * size
  }).length)
}

function TrendChart({ points }: { points: { day: Date; rate: number; runs: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2)
    return <div className="mut" style={{ padding: '60px 0', textAlign: 'center' }}>Run tests on at least two different days to see a trend.</div>
  const w = 720, h = 210, p = 24
  const min = Math.min(50, ...points.map(x => x.rate))
  const xy = points.map((x, i) => [p + (i * (w - 2 * p)) / (points.length - 1), h - p - ((x.rate - min) / (100 - min)) * (h - 2 * p)])
  const line = xy.map(a => a.join(',')).join(' ')
  const grid = [min, Math.round((min + 100) / 2), 100]
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - r.left) / r.width) * w
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((x - p) / (w - 2 * p)) * (points.length - 1)))))
        }}>
        {grid.map(v => {
          const y = h - p - ((v - min) / (100 - min)) * (h - 2 * p)
          return <g key={v}><line x1={p} x2={w - p} y1={y} y2={y} stroke="var(--track)" strokeDasharray="2 5" /><text x={0} y={y + 4} fontSize={11} fill="#94A3B8">{v}%</text></g>
        })}
        <defs>
          <linearGradient id="tl" x1="0" x2="1"><stop offset="0" stopColor="#F59E0B" /><stop offset="1" stopColor="#EC4899" /></linearGradient>
          <linearGradient id="ta" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#F59E0B" stopOpacity={0.28} /><stop offset="1" stopColor="#EC4899" stopOpacity={0} /></linearGradient>
        </defs>
        <polygon points={`${p},${h - p} ${line} ${w - p},${h - p}`} fill="url(#ta)" />
        <polyline className="draw" points={line} fill="none" stroke="url(#tl)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {xy.map((a, i) => <circle key={i} cx={a[0]} cy={a[1]} r={hover === i ? 7 : 4} fill="var(--card)" stroke="#F59E0B" strokeWidth={2.5} />)}
      </svg>
      {hover !== null && (
        <div style={{ position: 'absolute', top: 0, left: `calc(${(xy[hover][0] / w) * 100}% - 55px)`, background: '#0F172A', color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {points[hover].day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · <b>{points[hover].rate}%</b> · {points[hover].runs} runs
        </div>
      )}
    </div>
  )
}

// "Liquid glass" results card: Tests / Runs tabs, one bright ring with the pass rate, rows with shares.
function Results({ cases, runs }: { cases: { passed: number; failed: number; blocked: number }; runs: RunSummary[] }) {
  const [tab, setTab] = useState<'Tests' | 'Runs'>('Tests')
  const rows: [string, number, string][] = tab === 'Tests'
    ? [['Passed', cases.passed, '#22C55E'], ['Failed', cases.failed, '#EF4444'], ['Blocked', cases.blocked, '#F59E0B']]
    : (['Passed', 'Failed', 'Needs review'] as const).map(s => [s, runs.filter(r => r.status === s).length, s === 'Passed' ? '#22C55E' : s === 'Failed' ? '#EF4444' : '#F59E0B'])
  const total = rows.reduce((s, r) => s + r[1], 0)
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  const r = 54, c = 2 * Math.PI * r
  return (
    <div className="card glass s4" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="gtabs">
        {(['Tests', 'Runs'] as const).map(x => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x}</button>)}
      </div>
      <div style={{ position: 'relative', width: 140, height: 140, margin: '2px auto 0' }}>
        <svg viewBox="0 0 140 140" width={140} height={140} style={{ transform: 'rotate(-90deg)' }}>
          <defs><linearGradient id="rg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="var(--ring1)" /><stop offset="1" stopColor="var(--ring2)" /></linearGradient></defs>
          <circle cx={70} cy={70} r={r} fill="none" stroke="var(--track)" strokeWidth={10} />
          <circle key={tab} className="ring" cx={70} cy={70} r={r} fill="none" stroke="url(#rg)" strokeWidth={10} strokeLinecap="round"
            strokeDasharray={`${(pct(rows[0][1]) / 100) * c} ${c}`} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.03em' }}><CountUp n={pct(rows[0][1])} />%</div>
          <div className="mut" style={{ fontSize: 11 }}>{tab === 'Tests' ? 'tests passed' : 'runs passed'}</div>
        </div>
      </div>
      <div>
        {rows.map(([l, n, color]) => (
          <div key={l} className="grow"><span className="gbox" style={{ background: color }} /><span>{l}</span><span className="mut" style={{ marginLeft: 6, fontSize: 12 }}>{n}</span><b className="sp">{pct(n)}%</b></div>
        ))}
      </div>
    </div>
  )
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard({ go }: { go: (s: Screen) => void }) {
  const [all, setAll] = useState<RunSummary[] | null>(null)
  const [range, setRange] = useState<Range>('30d')
  const [error, setError] = useState('')

  useEffect(() => {
    api.runs().then(setAll).catch(e => setError(e.message))
  }, [])

  const days = RANGES[range]
  const runs = useMemo(() => (all || []).filter(r => Date.now() - new Date(r.created_at).getTime() < days * DAY), [all, days])
  const points = useMemo(() => trend(runs, days), [runs, days])
  const avg = points.length ? Math.round(points.reduce((s, x) => s + x.rate, 0) / points.length) : 0
  const attention = runs.filter(r => r.status === 'Failed' || r.status === 'Needs review').slice(0, 3)

  const head = (
    <div className="ph">
      <div>
        <h1>{greeting()} 👋</h1>
        <div className="sub">Here is how your tests are doing across all sites and apps.</div>
      </div>
      <div className="row">
        <div className="seg">
          {(Object.keys(RANGES) as Range[]).map(r => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
        <button className="btn p" onClick={() => go({ name: 'new' })}><Icon name="plus" size={16} />New Test Run</button>
      </div>
    </div>
  )

  if (error) return <>{head}<div className="err">{error}</div></>
  if (!all)
    return <>{head}<div className="g4">{[1, 2, 3, 4].map(i => <div key={i} className="sk" style={{ height: 112 }} />)}</div><div className="sk" style={{ height: 300 }} /></>
  if (!all.length)
    return (
      <>
        {head}
        <div style={{ border: '1.5px dashed var(--bd)', borderRadius: 14, background: 'var(--bg)', padding: '64px 24px', textAlign: 'center' }}>
          <div className="mk" style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: 14, background: 'var(--tint)', color: 'var(--prit)' }}><Icon name="rocket" size={26} /></div>
          <div className="f6" style={{ fontSize: 20 }}>Start your first test run</div>
          <div className="mut" style={{ maxWidth: 420, margin: '6px auto 18px' }}>Enter a website URL or an APK and what you want checked. Review the AI-generated plan, then approve it to run.</div>
          <button className="btn p" onClick={() => go({ name: 'new' })}><Icon name="plus" size={16} />Create test run</button>
        </div>
      </>
    )

  const kpis: [string, number, string, string, (r: RunSummary) => boolean][] = [
    ['Total runs', runs.length, '#4F46E5', 'All', () => true],
    ['Passed', runs.filter(r => r.status === 'Passed').length, '#16A34A', 'Passed', r => r.status === 'Passed'],
    ['Failed', runs.filter(r => r.status === 'Failed').length, '#DC2626', 'Failed', r => r.status === 'Failed'],
    ['Needs review', runs.filter(r => r.status === 'Needs review').length, '#D97706', 'Review', r => r.status === 'Needs review'],
  ]
  const latestFail = attention[0]
  const cases = runs.reduce((s, r) => ({ passed: s.passed + r.passed, failed: s.failed + r.failed, blocked: s.blocked + r.blocked }), { passed: 0, failed: 0, blocked: 0 })
  const sites = new Set(runs.map(r => host(r.url))).size
  const demo = `${location.origin.replace(':5173', ':8000')}/demo/`

  return (
    <>
      {head}
      <div className="bento">
        <div className="card glass hero s8">
          <span className="halo" />
          <div className="b ind" style={{ marginBottom: 14, alignSelf: 'flex-start' }}><Icon name="spark" size={13} />AI QA agent · last {range}</div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
            <div className="big" style={{ fontSize: 64, lineHeight: 1 }}><CountUp n={cases.failed} /></div>
            <div style={{ paddingBottom: 8 }}>
              <div className="f6" style={{ fontSize: 18 }}>bugs caught</div>
              <div className="mut" style={{ fontSize: 13 }}>failed tests, each with a screenshot and logs as evidence</div>
            </div>
          </div>
          <div className="chips">
            {([['play', cases.passed + cases.failed + cases.blocked, 'tests executed'], ['clock', runs.length, 'test runs'], ['globe', sites, 'sites and apps']] as [IconName, number, string][]).map(([icon, n, l]) => (
              <div key={l} className="chip"><span className="ibox"><Icon name={icon} size={16} /></span><div><b><CountUp n={n} /></b><span>{l}</span></div></div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 'auto', paddingTop: 20, flexWrap: 'wrap' }}>
            <button className="btn p" onClick={() => go({ name: 'new' })}><Icon name="plus" size={16} />New Test Run</button>
            <button className="btn" onClick={() => go({ name: 'new', prefill: { platform: 'web', url: demo } })}><Icon name="play" size={16} />Try the demo shop</button>
          </div>
        </div>
        <Results cases={cases} runs={runs} />
        {kpis.map(([label, n, color, filter, keep]) => (
          <button key={label} className="card glass kpi s3" onClick={() => go({ name: 'history', filter })}>
            <div className="l"><span className="row"><span className="dot" style={{ background: color }} />{label}</span><Spark data={buckets(runs, days, keep)} color={color} /></div>
            <div className="n"><CountUp n={n} /></div>
            <div className="mut" style={{ fontSize: 12 }}>{runs.length ? Math.round((n / runs.length) * 100) : 0}% of runs</div>
          </button>
        ))}
        <div className="card glass s8" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ch"><span>Pass rate trend</span><span className="mut f5" style={{ fontSize: 13 }}>{points.length ? `Avg ${avg}% · last ${range}` : `last ${range}`}</span></div>
          <div className="cb" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><TrendChart points={points} /></div>
        </div>
        <div className="s4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card glass next">
            <div className="cb">
              <div className="row" style={{ marginBottom: 6, color: 'var(--prit)' }}><Icon name="spark" size={16} /><span className="f6">Next step</span></div>
              {latestFail ? (
                <>
                  <div style={{ fontSize: 13 }}>Run #{latestFail.id} on {host(latestFail.url)} has {latestFail.failed} failed and {latestFail.blocked} blocked tests. Check the evidence, then re-run after a fix.</div>
                  <button className="btn s p" style={{ marginTop: 10 }} onClick={() => go({ name: 'run', runId: latestFail.id })}><Icon name="play" size={14} />Open run #{latestFail.id}</button>
                </>
              ) : <div style={{ fontSize: 13 }}>No failures in the last {range}. Nice work.</div>}
            </div>
          </div>
          <div className="card glass" style={{ flex: 1 }}>
            <div className="ch">Needs attention</div>
            {attention.length ? attention.map(r => (
              <button key={r.id} className="nav" style={{ borderRadius: 0, justifyContent: 'space-between', margin: 0, borderBottom: '1px solid var(--line)', padding: '12px 18px' }}
                onClick={() => go({ name: 'run', runId: r.id })}>
                <span style={{ color: 'var(--ink)', fontSize: 13 }}>{r.failed ? `${r.failed} failed` : `${r.blocked} blocked`} on {host(r.url)}</span>
                <Badge status={r.status} />
              </button>
            )) : <div className="cb mut" style={{ fontSize: 13 }}>Nothing to review.</div>}
          </div>
        </div>
      </div>
      <div className="card glass">
        <div className="ch">Recent test runs<button className="btn g s" onClick={() => go({ name: 'history' })}>View all</button></div>
        <table>
          <thead><tr><th>Target</th><th>Status</th><th>Date</th><th>Pass rate</th><th /></tr></thead>
          <tbody>{runs.slice(0, 6).map(r => <RunRow key={r.id} run={r} open={() => go({ name: 'run', runId: r.id })} />)}</tbody>
        </table>
      </div>
    </>
  )
}
