// Types mirror backend/app/models.py — keep them in sync.
export type Priority = 'High' | 'Medium' | 'Low'
export type Viewport = 'Desktop' | 'Tablet' | 'Mobile'
export type Status = 'Queued' | 'Running' | 'Passed' | 'Failed' | 'Blocked'
export type RunStatus = 'Running' | 'Passed' | 'Failed' | 'Needs review'
export type Platform = 'web' | 'android'

export const VIEWPORTS: Record<Viewport, string> = {
  Desktop: '1440 × 900',
  Tablet: '768 × 1024',
  Mobile: '390 × 844',
}

export interface TestCase {
  id: number
  title: string
  priority: Priority
  steps: string[]
  expected: string
}

// What to test: a website (url = https://…) or an Android app (url = APK path on the backend machine).
export interface Target {
  platform: Platform
  url: string
  viewport: Viewport
  clear_data: boolean
}

export interface TestResult {
  case: TestCase
  status: Status
  duration_s: number | null
  reason: string
  log: string[]
  screenshot: string | null
  console_errors: string[]
  network_errors: string[]
  final_url: string
  attempts: number
  bug: Bug | null
  question: Question | null
}

// A running test paused to ask the tester (backend questions.py).
export interface Question {
  question: string
  why: string
  options: string[]
  screenshot: string | null
  asked_at: string
  answer: string | null
}

// AI-written part of a bug report (backend ai.BUG_TOOL). Evidence is shown from the real result instead.
export interface Bug {
  title: string
  severity: 'Critical' | 'High' | 'Medium' | 'Low'
  steps: string[]
  expected: string
  actual: string
  likely_cause: string
  worth_checking: string[]
  confidence: 'High' | 'Medium' | 'Low'
}

export interface Settings {
  default_platform: Platform
  default_viewport: Viewport
  screenshots: boolean
  console_logs: boolean
  network_errors: boolean
  retry_failed: boolean
  ask_when_unsure: boolean
}

export interface Run {
  id: number
  platform: Platform
  url: string
  viewport: Viewport
  clear_data: boolean
  status: RunStatus
  created_at: string
  results: TestResult[]
}

export interface RunSummary {
  id: number
  platform: Platform
  url: string
  status: RunStatus
  created_at: string
  passed: number
  failed: number
  blocked: number
}

// The tester's own Anthropic key. Kept only in this variable: never saved to storage, gone on reload.
let apiKey = ''
export const getApiKey = () => apiKey
export function setApiKey(key: string) {
  apiKey = key.trim()
}
// Fired when the backend wants a key (401), so App can open the key dialog.
export const NEED_KEY = 'testpilot:need-key'

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'X-Anthropic-Key': apiKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) window.dispatchEvent(new Event(NEED_KEY))
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // FastAPI sends a string, or a list of validation errors ({ msg }) for 422
    const detail = typeof err.detail === 'string' ? err.detail
      : Array.isArray(err.detail) ? err.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('; ')
      : `Request failed (${res.status})`
    throw new Error(detail)
  }
  return res.json()
}

export const api = {
  plan: (target: Target, requirements: string) =>
    call<{ cases: TestCase[] }>('/api/plans', { ...target, requirements }),
  startRun: (target: Target, cases: TestCase[]) => call<Run>('/api/runs', { ...target, cases }),
  devices: () => call<{ devices: string[] }>('/api/android/devices'),
  run: (id: number) => call<Run>(`/api/runs/${id}`),
  runs: () => call<RunSummary[]>('/api/runs'),
  bug: (runId: number, caseId: number, regenerate = false) =>
    call<Bug>(`/api/runs/${runId}/cases/${caseId}/bug?regenerate=${regenerate}`, {}),
  answer: (runId: number, caseId: number, answer: string, skip = false) =>
    call<{ ok: boolean }>(`/api/runs/${runId}/cases/${caseId}/answer`, { answer, skip }),
  settings: () => call<Settings>('/api/settings'),
  saveSettings: (s: Settings) => call<Settings>('/api/settings', s, 'PUT'),
  health: () => call<{ ok: boolean; provider: string; model: string; needs_key: boolean }>('/api/health'),
}
