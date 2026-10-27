// Markdown exports for a run and for one bug, built from the saved run data.
import { VIEWPORTS, type Run, type TestResult } from './api'

const where = (run: Run) => (run.platform === 'android' ? 'Android' : `Chromium · ${VIEWPORTS[run.viewport]}`)

// Errors observed during the run (not AI): console/app errors, failed requests, actions that errored.
export function observed(run: Run, r: TestResult): string[] {
  // The same error repeated (e.g. a button clicked twice) is listed once.
  return [...new Set([
    ...r.network_errors.map(e => `Request: ${e}`),
    ...r.console_errors.map(e => `${run.platform === 'android' ? 'App error' : 'Console error'}: ${e}`),
    ...r.log.filter(l => l.startsWith('ERROR')).map(l => `Action failed: ${l.slice(6)}`),
    ...(r.final_url && run.platform === 'web' ? [`Page at the end of the test: ${r.final_url}`] : []),
  ])]
}

export function runMarkdown(run: Run): string {
  const count = (s: string) => run.results.filter(r => r.status === s).length
  const lines = [
    `# Test report — ${run.url}`,
    '',
    `Run #${run.id} · ${where(run)} · ${run.created_at.replace('T', ' ')} · **${run.status}**`,
    '',
    `Passed ${count('Passed')} · Failed ${count('Failed')} · Blocked ${count('Blocked')}`,
    '',
    '| # | Test | Result | Time |',
    '|---|---|---|---|',
    ...run.results.map((r, i) => `| ${i + 1} | ${r.case.title} | ${r.status} | ${r.duration_s ?? '-'}s |`),
  ]
  for (const r of run.results.filter(x => x.status !== 'Passed')) {
    lines.push('', `## ${r.status}: ${r.case.title}`, '', `**Expected:** ${r.case.expected}`, '', `**Verdict:** ${r.reason}`)
    const obs = observed(run, r)
    if (obs.length) lines.push('', '**Observed:**', ...obs.map(o => `- ${o}`))
    lines.push('', '**Log:**', '```', ...r.log, '```')
  }
  return lines.join('\n')
}

export function bugMarkdown(run: Run, r: TestResult): string {
  const b = r.bug!
  return [
    `# ${b.title}`,
    '',
    `**Severity:** ${b.severity} · ${run.url} · ${where(run)} · Run #${run.id}`,
    '',
    '## Steps to reproduce',
    ...b.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `## Expected\n${b.expected}`,
    '',
    `## Actual\n${b.actual}`,
    '',
    '## Evidence (observed during the run)',
    ...(observed(run, r).map(o => `- ${o}`).concat(r.screenshot ? [`- Screenshot: ${location.origin}${r.screenshot}`] : [])),
    '',
    `## Likely cause (AI, not confirmed — confidence ${b.confidence})`,
    b.likely_cause,
    '',
    '**Worth checking:**',
    ...b.worth_checking.map(w => `- ${w}`),
  ].join('\n')
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
