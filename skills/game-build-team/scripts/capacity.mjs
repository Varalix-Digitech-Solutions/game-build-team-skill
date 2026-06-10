#!/usr/bin/env node
// capacity.mjs — right-size a game-build-team run to the HOST so nothing gets
// OOM-killed. Outputs a SAFE concurrent-feature budget and the derived waveSize.
//
// This is what makes the run DYNAMIC: the step order is fixed, but how many
// features build in parallel is sized to the machine the run lands on.
//
// THE CONSTRAINT (Godot, not browsers):
//  - Each parallel feature build runs a Tester that spawns `godot --headless`
//    for the suite (~300–900MB) and a screenshot capture (xvfb + a windowed
//    godot, ~500MB–1.2GB). Budget PER CONCURRENT FEATURE, not per agent.
//    This is FAR lighter than clone-team's ~4.2GB Chromium sessions, so the
//    safe wave is usually larger — but a tight box / many sim entities still
//    OOMs, so we probe instead of guessing.
//  - On Linux, systemd-oomd culls a whole cgroup on sustained memory *pressure*
//    (PSI), by default ~50% for 20s, BEFORE RAM is exhausted. So we keep TOTAL
//    run memory under a safe fraction of TOTAL ram, not just "fit in free RAM".
//
// Runs in normal Node (the Manager calls it), NOT in the Workflow sandbox.
//
// Usage:
//   node scripts/capacity.mjs            # full JSON report
//   node scripts/capacity.mjs --wave     # just the recommended waveSize (integer)
//
// Tunables (env overrides):
//   GBT_PER_FEATURE_MB  RAM per concurrent feature build (default 1400; godot test + xvfb shot)
//   GBT_RESERVE_MB      held back for Claude CLI (~2GB) + godot editor + OS + headroom (default 3072)
//   GBT_MAX_WAVE        hard ceiling on concurrency (default 8)
//   GBT_PRESSURE_BUDGET fraction of TOTAL ram the run may occupy before oomd risk (default 0.6)

import os from 'os'
import fs from 'fs'
import { execSync } from 'child_process'

function availableMB() {
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8')
    const m = mi.match(/MemAvailable:\s+(\d+)\s+kB/)
    if (m) return Math.round(parseInt(m[1], 10) / 1024)
  } catch { /* not Linux — fall back */ }
  return Math.round(os.freemem() / 1024 / 1024)
}

// systemd-oomd: detect it and read the user-slice memory-pressure kill limit.
function oomdInfo() {
  try {
    const active = execSync('systemctl is-active systemd-oomd 2>/dev/null', { encoding: 'utf8' }).trim() === 'active'
    if (!active) return { active: false, limitPct: null }
    let limitPct = 50 // systemd default DefaultMemoryPressureLimitPercent
    try {
      const uid = process.getuid ? process.getuid() : 1000
      const out = execSync(`systemctl show user@${uid}.service -p ManagedOOMMemoryPressureLimit 2>/dev/null`, { encoding: 'utf8' })
      const m = out.match(/=(\d+)/)
      if (m && Number(m[1]) > 0) limitPct = Math.round(Number(m[1]) / 4294967296 * 100)
    } catch { /* keep default */ }
    return { active: true, limitPct }
  } catch { return null }
}

function pressureNow() {
  try {
    const p = fs.readFileSync('/proc/pressure/memory', 'utf8')
    const some = p.match(/some .*avg10=([\d.]+)/)
    return some ? Number(some[1]) : null
  } catch { return null }
}

const PER_FEATURE_MB = Number(process.env.GBT_PER_FEATURE_MB || 1400) // godot headless suite + xvfb screenshot capture
const RESERVE_MB = Number(process.env.GBT_RESERVE_MB || 3072)        // Claude CLI (~2GB) + godot editor + OS + pressure headroom
const HARD_MAX = Number(process.env.GBT_MAX_WAVE || 8)
const PRESSURE_BUDGET = Number(process.env.GBT_PRESSURE_BUDGET || 0.6)

const totalMB = Math.round(os.totalmem() / 1024 / 1024)
const availMB = availableMB()
const cores = os.cpus().length
const load1 = Number((os.loadavg()[0] || 0).toFixed(2))
const oomd = oomdInfo()
const psi = pressureNow()

const byRam = Math.floor((availMB - RESERVE_MB) / PER_FEATURE_MB)
const pressureFrac = oomd && oomd.active
  ? Math.min(PRESSURE_BUDGET, (oomd.limitPct || 50) / 100 - 0.05)
  : 1
const byPressure = oomd && oomd.active
  ? Math.floor((totalMB * pressureFrac - RESERVE_MB) / PER_FEATURE_MB)
  : Infinity

const byCpu = Math.max(1, cores - 2)
const loadPenalty = load1 > cores ? 1 : 0

let maxFeatures = Math.min(byRam, byPressure, byCpu, HARD_MAX) - loadPenalty
maxFeatures = Math.max(1, maxFeatures)

const recommendedWaveSize = maxFeatures

const bound = maxFeatures === byPressure ? 'pressure(oomd)'
  : maxFeatures === byRam ? 'ram'
  : maxFeatures === byCpu ? 'cpu'
  : 'ceiling'

const report = {
  totalMB, availableMB: availMB, totalGB: +(totalMB / 1024).toFixed(1), availableGB: +(availMB / 1024).toFixed(1),
  cores, load1,
  oomd: oomd && oomd.active ? { active: true, pressureKillLimitPct: oomd.limitPct } : { active: false },
  memPressureAvg10: psi,
  perFeatureMB: PER_FEATURE_MB, reserveMB: RESERVE_MB, hardMax: HARD_MAX, pressureBudgetFrac: pressureFrac,
  byRam, byPressure: byPressure === Infinity ? null : byPressure, byCpu, loadPenalty,
  maxConcurrentFeatures: maxFeatures,
  recommendedWaveSize,
  boundBy: bound,
  rationale: `${oomd && oomd.active ? `systemd-oomd active (kills user slice at ~${oomd.limitPct}% pressure) → budget ${(pressureFrac * 100).toFixed(0)}% of ${(totalMB / 1024).toFixed(1)}GB. ` : ''}~${PER_FEATURE_MB}MB per concurrent feature (godot suite + xvfb shot), reserve ${(RESERVE_MB / 1024).toFixed(1)}GB → max ${maxFeatures} concurrent feature(s) [${bound}-bound]. waveSize=${recommendedWaveSize}.`,
}

if (process.argv.includes('--wave')) console.log(recommendedWaveSize)
else console.log(JSON.stringify(report, null, 2))
