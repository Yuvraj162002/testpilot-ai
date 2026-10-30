import type { Screen } from '../App'
import { Icon, type IconName } from '../icons'

type Item = [IconName, string, string]

const GROUPS: [string, string, Item[]][] = [
  ['Next up', 'The first things we are building.', [
    ['mob', 'iOS app testing', 'Test iPhone apps the same way as Android APKs: the AI plans the tests, taps through the app and reports bugs with screenshots.'],
    ['globe', 'Hosted version', 'Use TestPilot AI straight from the browser. No setup, nothing to install on your computer.'],
    ['spark', 'No API key needed', 'Start testing right away. Bringing your own Anthropic key becomes optional.'],
    ['eye', 'Compare with Figma', 'Link a Figma design and the AI checks the live page against it: missing elements, wrong text, layout differences.'],
  ]],
  ['Fits your workflow', 'TestPilot AI where your team already works.', [
    ['link', 'Jira, Slack and Teams', 'Send a bug report to Jira as a ticket, or post run results to a Slack or Teams channel in one click.'],
    ['clock', 'Scheduled runs', 'Run a saved test plan every night and get an alert when something that used to pass starts failing.'],
    ['play', 'CI integration', 'Run your test plans from GitHub Actions on every pull request or deploy.'],
  ]],
  ['Deeper testing', 'More kinds of bugs, caught automatically.', [
    ['desk', 'Visual changes', 'Compare screenshots with the last run and flag pages whose layout changed.'],
    ['ok', 'Accessibility checks', 'Report missing labels, low contrast and keyboard traps alongside the test results.'],
    ['key', 'Sites behind a login', 'Save a test account once and test the pages behind the login screen.'],
  ]],
]

export default function ComingSoon({ go }: { go: (s: Screen) => void }) {
  return (
    <>
      <div className="ph">
        <div>
          <h1>Coming soon</h1>
          <div className="sub">What we're building next.</div>
        </div>
        <button className="btn p" onClick={() => go({ name: 'new' })}><Icon name="plus" size={16} />New Test Run</button>
      </div>
      <div className="card cb row" style={{ background: 'linear-gradient(135deg, var(--tint), var(--card))', padding: 22, marginBottom: 26, gap: 16 }}>
        <div className="mk" style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0 }}><Icon name="rocket" size={24} /></div>
        <div>
          <div className="f6" style={{ fontSize: 17 }}>TestPilot AI is just getting started</div>
          <div className="mut" style={{ fontSize: 14 }}>Today it tests websites and Android apps with grounded verdicts and real evidence. Here is where it goes next.</div>
        </div>
      </div>
      {GROUPS.map(([group, sub, items], g) => (
        <section key={group} style={{ marginBottom: 28 }}>
          <div style={{ marginBottom: 12 }}>
            <div className="f6" style={{ fontSize: 16 }}>{group}</div>
            <div className="mut" style={{ fontSize: 13 }}>{sub}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${g === 0 ? 400 : 260}px, 100%), 1fr))`, gap: 14 }}>
            {items.map(([icon, title, text]) => (
              <div key={title} className="card cb hov" style={g === 0 ? { borderTop: '3px solid var(--pri)' } : undefined}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <div className="mk" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--tint)', color: 'var(--prit)' }}><Icon name={icon} /></div>
                  <span className="sp" style={{ fontSize: 11, fontWeight: 600, color: 'var(--prit)', background: 'var(--tint)', borderRadius: 999, padding: '3px 10px' }}>Coming soon</span>
                </div>
                <div className="f6" style={{ fontSize: 15, marginBottom: 4 }}>{title}</div>
                <div className="mut" style={{ fontSize: 13, lineHeight: 1.5 }}>{text}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
