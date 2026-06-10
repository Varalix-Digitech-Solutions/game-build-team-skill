#!/usr/bin/env node
// report.mjs — durable results-analysis record for game-build-team runs.
// This is the single source of truth for "how did this run turn out": it
// captures every gate verdict (per feature, per round, per GATE — test or
// creative) with issue counts and the screenshot that proves it, then renders a
// self-contained HTML report from it.
//
// It mirrors state.mjs on purpose (same argv parsing, same --dir convention,
// same .game-build-team/ dir, same OS-clock-here rule) so the two read like one
// toolkit. state.mjs tracks LIFECYCLE (what phase / which features are
// done/tested/built/pending); report.mjs tracks OUTCOME (what the gate verdicts
// were). The Workflow runtime cannot write files, so the Tester (test gate), the
// Creative Director (creative gate), and the Manager (on completion) call this
// CLI to persist what would otherwise vanish with the Workflow's in-memory return.
//
// Two gates, recorded separately so you can see WHERE a feature struggled:
//   gate=test     — correctness (Tester): suite green + screenshot + invariants
//   gate=creative — fun (Creative Director): readable/responsive/satisfying/...
//
// Usage:
//   node report.mjs init         --dir <projectDir> [--run-id wf_x] [--goal ..] [--target ..] [--engine ..]
//   node report.mjs append-round --dir <projectDir> --feature <name> --round <N> --gate test|creative \
//                                --verdict OK|NG --issues-json '<json-array>' \
//                                [--screenshot <relpath>] [--feature-status done|tested|building|flagged]
//   node report.mjs finalize     --dir <projectDir> --final-verdict OK|NG --summary-json '<json>' [--drift-json '<json-array>']
//   node report.mjs json         --dir <projectDir>
//   node report.mjs render       --dir <projectDir>           # writes .game-build-team/report.html

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) a[key] = true
      else { a[key] = next; i++ }
    } else a._.push(t)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
const dir = args.dir || process.cwd()
const stateDir = path.join(dir, '.game-build-team')
const reportFile = path.join(stateDir, 'report.json')
const htmlFile = path.join(stateDir, 'report.html')

function nowIso() { return new Date().toISOString() }

function readReport() {
  if (!fs.existsSync(reportFile)) {
    console.error(`No report at ${reportFile}. Run "report.mjs init" first.`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(reportFile, 'utf8'))
}

function writeReport(r) {
  r.updatedAt = nowIso()
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(reportFile, JSON.stringify(r, null, 2) + '\n')
  return r
}

function defaultReport() {
  return {
    version: 1,
    runId: args['run-id'] || null,
    goal: args.goal || '',
    target: args.target || '',
    engine: args.engine || 'godot',
    startedAt: nowIso(),
    completedAt: null,
    finalVerdict: 'not-run',
    summary: { features: 0, done: 0, flagged: [] },
    features: [],
    drift: [],
    artifacts: { html: '.game-build-team/report.html' },
    updatedAt: nowIso(),
  }
}

function countIssues(issues) {
  const c = { blocker: 0, major: 0, minor: 0 }
  for (const it of issues || []) {
    if (it && c[it.severity] !== undefined) c[it.severity]++
  }
  return c
}

function parseJsonArg(name, fallback) {
  const raw = args[name]
  if (raw === undefined || raw === true) return fallback
  try { return JSON.parse(raw) } catch (e) { console.error(`Invalid --${name}: ${e.message}`); process.exit(2) }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}

switch (cmd) {
  case 'init': {
    if (fs.existsSync(reportFile)) { console.log(`Report already exists at ${reportFile}`); break }
    const r = writeReport(defaultReport())
    console.log(`Initialized ${reportFile}`)
    console.log(JSON.stringify(r, null, 2))
    break
  }

  case 'append-round': {
    const r = readReport()
    const name = args.feature
    if (!name) { console.error('--feature required'); process.exit(2) }
    const gate = args.gate === 'creative' ? 'creative' : 'test'
    const verdict = args.verdict === 'OK' ? 'OK' : 'NG'
    const round = args.round !== undefined ? Number(args.round) : 1
    const issues = parseJsonArg('issues-json', [])

    let feat = r.features.find(f => f.name === name)
    if (!feat) { feat = { name, status: 'building', rounds: [] }; r.features.push(feat) }

    const roundRec = { round, gate, verdict, at: nowIso(), issueCounts: countIssues(issues), issues }
    if (args.screenshot && args.screenshot !== true) roundRec.screenshot = args.screenshot
    feat.rounds.push(roundRec)

    // Derive feature status from the latest round. An explicit --feature-status
    // (e.g. 'flagged' when the Manager hits the round cap, or 'done'/'tested' to
    // match state.mjs) always wins over the derived value.
    if (args['feature-status']) {
      feat.status = args['feature-status']
    } else if (verdict === 'NG') {
      feat.status = 'building'
    } else {
      // OK on the test gate => tested; OK on the creative gate => done.
      feat.status = gate === 'creative' ? 'done' : 'tested'
    }

    writeReport(r)
    console.log(`${gate}-gate round ${round} (${verdict}) recorded for "${name}" -> ${feat.status}`)
    break
  }

  case 'finalize': {
    const r = readReport()
    if (args['final-verdict']) r.finalVerdict = args['final-verdict'] === 'OK' ? 'OK' : (args['final-verdict'] === 'not-run' ? 'not-run' : 'NG')
    const summary = args['summary-json'] !== undefined ? parseJsonArg('summary-json', null) : null
    if (summary) r.summary = { ...r.summary, ...summary }
    const drift = args['drift-json'] !== undefined ? parseJsonArg('drift-json', null) : null
    if (drift) r.drift = drift
    // Derive summary from features when not explicitly provided.
    if (!summary) {
      r.summary.features = r.features.length
      r.summary.done = r.features.filter(f => f.status === 'done').length
      r.summary.flagged = r.features.filter(f => f.status === 'flagged').map(f => f.name)
    }
    r.completedAt = nowIso()
    writeReport(r)
    console.log(`finalized: ${r.finalVerdict} (${r.summary.done}/${r.summary.features} done)`)
    break
  }

  case 'json': {
    console.log(JSON.stringify(readReport(), null, 2))
    break
  }

  case 'render': {
    const r = readReport()
    const html = renderHtml(r)
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(htmlFile, html)
    console.log(`rendered ${htmlFile}`)
    break
  }

  default:
    console.error('Unknown command. See header of report.mjs for usage.')
    process.exit(2)
}

// --- HTML renderer ----------------------------------------------------------
// Self-contained: no external CSS/JS. Source of truth is report.json; this is
// the disposable human "receipt" (JSON-then-render convention).
function renderHtml(r) {
  const vClass = v => v === 'OK' ? 'ok' : v === 'NG' ? 'ng' : 'na'
  const statusOk = s => s === 'done'
  const trendFor = (rounds, gate) => rounds.filter(rd => rd.gate === gate)
    .map(rd => `R${rd.round} <span class="${vClass(rd.verdict)}">${esc(rd.verdict)}</span>`).join(' → ') || '—'

  const featureRows = (r.features || []).map(feat => {
    const totals = feat.rounds.reduce((acc, rd) => {
      acc.blocker += rd.issueCounts.blocker; acc.major += rd.issueCounts.major; acc.minor += rd.issueCounts.minor; return acc
    }, { blocker: 0, major: 0, minor: 0 })
    const lastShot = [...feat.rounds].reverse().find(rd => rd.screenshot)
    const shotCell = lastShot ? `<a class="mut" href="${esc(lastShot.screenshot)}">frame</a>` : '<span class="mut">—</span>'
    const badgeClass = statusOk(feat.status) ? 'ok' : feat.status === 'tested' ? 'warn' : 'ng'
    return `<tr>
      <td><b>${esc(feat.name)}</b></td>
      <td><span class="badge ${badgeClass}">${esc(feat.status)}</span></td>
      <td class="num">${feat.rounds.length}</td>
      <td>${trendFor(feat.rounds, 'test')}</td>
      <td>${trendFor(feat.rounds, 'creative')}</td>
      <td>${shotCell}</td>
      <td class="num"><span class="bl">${totals.blocker}</span>/<span class="mj">${totals.major}</span>/<span class="mn">${totals.minor}</span></td>
    </tr>`
  }).join('')

  // Outstanding issues = issues from each feature's LAST round (the state it ended in).
  const issueBlocks = (r.features || []).map(feat => {
    const last = feat.rounds[feat.rounds.length - 1]
    if (!last || !last.issues || !last.issues.length) return ''
    const items = last.issues.map(i => `<li><span class="sev ${esc(i.severity)}">${esc(i.severity)}</span> <b>${esc(i.area)}</b> — ${esc(i.description)}<br><span class="mut">expected: ${esc(i.expected)} · actual: ${esc(i.actual)}${i.repro ? ' · repro: ' + esc(i.repro) : ''}</span></li>`).join('')
    return `<h3>${esc(feat.name)} — open issues (${esc(last.gate)} gate, round ${last.round}, ${esc(last.verdict)})</h3><ul class="issues">${items}</ul>`
  }).join('')

  const driftBlock = (r.drift && r.drift.length)
    ? '<h2>Drift flags</h2><ul class="issues">' + r.drift.map(d => `<li><b>${esc(d.feature || d.area || 'drift')}</b> — ${esc(d.description || d)}${d.decision ? `<br><span class="mut">vs ${esc(d.decision)}</span>` : ''}</li>`).join('') + '</ul>'
    : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>game-build-team report — ${esc(r.goal || r.runId || 'run')}</title>
<style>
  :root{--bg:#0b0e14;--panel:#121722;--ink:#e6edf3;--mut:#9aa7b4;--line:#1e2733;--accent:#7c93ff;--good:#34d399;--bad:#f87171;--warn:#fbbf24;--mono:ui-monospace,"Cascadia Code",Consolas,monospace}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:40px 22px 80px}
  h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}
  h2{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:9px;margin:36px 0 14px}
  h3{font-size:15px;margin:22px 0 6px}
  .meta{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0 4px}
  .pill{font:600 12px/1 var(--mono);padding:7px 10px;border-radius:999px;background:#1a2230;border:1px solid var(--line);color:var(--mut)}
  .pill b{color:var(--ink)}
  .verdict{display:inline-block;font:800 13px/1 var(--mono);padding:9px 14px;border-radius:10px;margin-top:14px}
  .verdict.ok{background:#0f1f18;color:var(--good);border:1px solid #244c3a}
  .verdict.ng{background:#1f1313;color:var(--bad);border:1px solid #4c2424}
  .verdict.na{background:#171b24;color:var(--mut);border:1px solid var(--line)}
  table{width:100%;border-collapse:collapse;font-size:13.5px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#0f141d;color:var(--mut);font:600 11px/1.2 var(--mono);letter-spacing:.04em;text-transform:uppercase}
  tr:last-child td{border-bottom:none}
  .num{font:600 13px/1.3 var(--mono);text-align:right;white-space:nowrap}
  .mut{color:var(--mut)} .ok{color:var(--good)} .ng{color:var(--bad)} .na{color:var(--mut)}
  .badge{font:700 11px/1 var(--mono);padding:4px 8px;border-radius:6px}
  .badge.ok{background:#0f1f18;color:var(--good)} .badge.ng{background:#1f1313;color:var(--bad)} .badge.warn{background:#211a08;color:var(--warn)}
  .bl{color:var(--bad)} .mj{color:var(--warn)} .mn{color:var(--mut)}
  ul.issues{list-style:none;padding:0;margin:8px 0}
  ul.issues li{border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin:7px 0;background:var(--panel)}
  .sev{font:700 10px/1 var(--mono);padding:3px 6px;border-radius:5px;text-transform:uppercase}
  .sev.blocker{background:#1f1313;color:var(--bad)} .sev.major{background:#211a08;color:var(--warn)} .sev.minor{background:#171b24;color:var(--mut)}
  footer{margin-top:40px;color:var(--mut);font-size:12.5px;border-top:1px solid var(--line);padding-top:16px;font-family:var(--mono)}
</style></head>
<body><div class="wrap">
  <h1>🎮 game-build-team — run report</h1>
  <div class="meta">
    ${r.runId ? `<span class="pill">run <b>${esc(r.runId)}</b></span>` : ''}
    ${r.target ? `<span class="pill">target <b>${esc(r.target)}</b></span>` : ''}
    ${r.engine ? `<span class="pill">engine <b>${esc(r.engine)}</b></span>` : ''}
    <span class="pill">started <b>${esc(r.startedAt)}</b></span>
    <span class="pill">completed <b>${esc(r.completedAt || 'in progress')}</b></span>
  </div>
  ${r.goal ? `<p class="mut">${esc(r.goal)}</p>` : ''}
  <div class="verdict ${vClass(r.finalVerdict)}">FINAL: ${esc(r.finalVerdict)}</div>
  <span class="pill" style="margin-left:8px">done <b>${r.summary.done}/${r.summary.features}</b></span>
  ${r.summary.flagged && r.summary.flagged.length ? `<span class="pill">flagged <b>${esc(r.summary.flagged.join(', '))}</b></span>` : ''}

  <h2>Scorecard — done means verified AND fun</h2>
  <table>
    <tr><th>Feature</th><th>Status</th><th>Rounds</th><th>Test gate</th><th>Creative gate</th><th>Frame</th><th>Issues b/m/n</th></tr>
    ${featureRows || '<tr><td colspan="7" class="mut">No features recorded.</td></tr>'}
  </table>

  ${issueBlocks ? '<h2>Outstanding issues</h2>' + issueBlocks : ''}
  ${driftBlock}

  <footer>report.json is the source of truth · regenerate this file with <code>node report.mjs render --dir &lt;projectDir&gt;</code></footer>
</div></body></html>`
}
