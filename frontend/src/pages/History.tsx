import { useEffect, useState } from 'react'
import { api, type RunSummary } from '../api'
import type { Screen } from '../App'
import { host, passRate, RunRow } from '../components'
import { Icon } from '../icons'

const FILTERS = ['All', 'Passed', 'Failed', 'Review'] as const
type Filter = (typeof FILTERS)[number]

const matches = (r: RunSummary, f: Filter) =>
  f === 'All' || (f === 'Review' ? r.status === 'Needs review' : r.status === f)

export default function History({ go, initialFilter }: { go: (s: Screen) => void; initialFilter?: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>(FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : 'All')
  const [sort, setSort] = useState<'date' | 'rate'>('date')

  useEffect(() => {
    api.runs().then(setRuns).catch(e => setError(e.message))
  }, [])

  const searched = (runs || []).filter(r => host(r.url).toLowerCase().includes(q.toLowerCase()) || String(r.id) === q.trim())
  let shown = searched.filter(r => matches(r, filter))
  if (sort === 'rate') shown = [...shown].sort((a, b) => passRate(a) - passRate(b))

  return (
    <>
      <div className="ph">
        <div><h1>Test history</h1><div className="sub">Every run. Open any run to see its report.</div></div>
        <button className="btn p" onClick={() => go({ name: 'new' })}><Icon name="plus" size={16} />New Test Run</button>
      </div>
      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="inp" style={{ width: 300 }}>
          <Icon name="search" size={16} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by website, app or run #" />
        </div>
        {FILTERS.map(f => (
          <button key={f} className={`btn s ${filter === f ? 'p' : ''}`} onClick={() => setFilter(f)}>
            {f === 'Review' ? 'Needs review' : f}<span style={{ opacity: 0.7 }}>{searched.filter(r => matches(r, f)).length}</span>
          </button>
        ))}
        <div className="inp sp" style={{ width: 180 }}>
          <select value={sort} onChange={e => setSort(e.target.value as 'date' | 'rate')}>
            <option value="date">Newest first</option>
            <option value="rate">Lowest pass rate</option>
          </select>
        </div>
      </div>
      {error && <div className="err">{error}</div>}
      <div className="card" style={{ overflow: 'auto' }}>
        <table>
          <thead><tr><th>Target</th><th>Status</th><th>Date</th><th>Pass rate</th><th /></tr></thead>
          <tbody>
            {runs === null && <tr><td colSpan={5}><div className="sk" style={{ height: 120 }} /></td></tr>}
            {runs && !shown.length && (
              <tr><td colSpan={5} className="mut" style={{ textAlign: 'center', padding: 40 }}>
                {runs.length ? 'No runs match. Try another search or filter.' : 'No runs yet.'}
              </td></tr>
            )}
            {shown.map(r => <RunRow key={r.id} run={r} open={() => go({ name: 'run', runId: r.id })} />)}
          </tbody>
        </table>
      </div>
    </>
  )
}
