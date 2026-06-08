#!/usr/bin/env node
// state.mjs — durable state for game-build-team runs.
// The Manager uses these helpers instead of hand-editing .game-build-team/state.json,
// so the file stays valid and every change is timestamped. Time is read here
// (from the OS), never inside the Workflow script where clocks are unavailable.
//
// Usage:
//   node scripts/state.mjs init        --dir <projectDir> [--goal ..] [--godot ..]
//   node scripts/state.mjs get         --dir <projectDir>
//   node scripts/state.mjs status      --dir <projectDir>
//   node scripts/state.mjs set         --dir <projectDir> --key phase --value build
//   node scripts/state.mjs set-phase   --dir <projectDir> --phase build
//   node scripts/state.mjs set-run     --dir <projectDir> --run-id wf_xxx
//   node scripts/state.mjs add-feature --dir <projectDir> --json '{"name":"Serve HUD",...}'
//   node scripts/state.mjs mark-feature --dir <projectDir> --name "Serve HUD" --status done [--rounds 2]
//   node scripts/state.mjs reconcile   --dir <projectDir>   # sync state<->disk before resume
//   node scripts/state.mjs remaining   --dir <projectDir>   # prints not-done features as JSON

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const key = t.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) { a[key] = true }
      else { a[key] = next; i++ }
    } else a._.push(t)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
const dir = args.dir || process.cwd()
const stateDir = path.join(dir, '.game-build-team')
const stateFile = path.join(stateDir, 'state.json')

function nowIso() { return new Date().toISOString() }

function readState() {
  if (!fs.existsSync(stateFile)) {
    console.error(`No state file at ${stateFile}. Run "init" first.`)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
}

function writeState(s) {
  s.updatedAt = nowIso()
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2) + '\n')
  return s
}

function defaultState() {
  return {
    version: 1,
    goal: args.goal || '',
    projectDir: dir,
    godotBin: args.godot || 'godot',
    designRefs: args.designRefs || 'graphify-out',
    runConfig: { modelTier: 'max-fidelity', autonomy: 'autonomous', maxRounds: 4, finalCap: 3, docsDepth: 'none', waveSize: 0, skipFinal: false },
    paths: { features: 'docs/features', verifyScript: '', statePath: '', skillDir: '' },
    phase: 'setup',
    lastRunId: null,
    features: [],
    docs: { status: 'pending', docPath: 'docs/features/IMPACT.md' },
    flagged: [],
    updatedAt: nowIso(),
  }
}

function setDeep(obj, dottedKey, value) {
  const parts = dottedKey.split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}
    o = o[parts[i]]
  }
  o[parts[parts.length - 1]] = value
}

function coerce(v) {
  if (v === 'true') return true
  if (v === 'false') return false
  if (v !== '' && !isNaN(Number(v))) return Number(v)
  return v
}

// A feature is "really done" only if marked done AND at least one target file exists.
function fileExistsFor(feat) {
  const files = feat.targetFiles || (feat.targetFile ? [feat.targetFile] : [])
  if (files.length === 0) return true // no declared files (e.g. test-only change) — trust the marker
  return files.some(f => fs.existsSync(path.join(dir, f)))
}

switch (cmd) {
  case 'init': {
    if (fs.existsSync(stateFile)) { console.log(`State already exists at ${stateFile}`); break }
    const s = writeState(defaultState())
    console.log(`Initialized ${stateFile}`)
    console.log(JSON.stringify(s, null, 2))
    break
  }
  case 'get': {
    console.log(JSON.stringify(readState(), null, 2))
    break
  }
  case 'status': {
    const s = readState()
    const by = (st) => s.features.filter(x => x.status === st).map(x => x.name)
    console.log(`game-build-team status — ${stateFile}`)
    console.log(`  goal:    ${s.goal || '(unset)'}`)
    console.log(`  godot:   ${s.godotBin}`)
    console.log(`  phase:   ${s.phase}`)
    console.log(`  tier:    ${s.runConfig?.modelTier}  autonomy: ${s.runConfig?.autonomy}`)
    console.log(`  lastRun: ${s.lastRunId || '(none)'}`)
    console.log(`  features: ${s.features.length} total`)
    console.log(`     done:     ${by('done').length}  ${by('done').join(', ')}`)
    console.log(`     tested:   ${by('tested').length}  ${by('tested').join(', ')}`)
    console.log(`     building: ${by('building').length}  ${by('building').join(', ')}`)
    console.log(`     built:    ${by('built').length}  ${by('built').join(', ')}`)
    console.log(`     spec:     ${by('spec').length}  ${by('spec').join(', ')}`)
    console.log(`     pending:  ${by('pending').length}  ${by('pending').join(', ')}`)
    console.log(`     flagged:  ${by('flagged').length}  ${by('flagged').join(', ')}`)
    console.log(`  docs:    ${s.docs?.status} -> ${s.docs?.docPath}`)
    break
  }
  case 'set': {
    const s = readState()
    if (!args.key) { console.error('--key required'); process.exit(2) }
    setDeep(s, args.key, coerce(args.value))
    writeState(s)
    console.log(`set ${args.key} = ${args.value}`)
    break
  }
  case 'set-phase': {
    const s = readState(); s.phase = args.phase; writeState(s)
    console.log(`phase -> ${args.phase}`)
    break
  }
  case 'set-run': {
    const s = readState(); s.lastRunId = args['run-id']; writeState(s)
    console.log(`lastRunId -> ${args['run-id']}`)
    break
  }
  case 'add-feature': {
    const s = readState()
    let feat
    try { feat = JSON.parse(args.json) } catch (e) { console.error('Invalid --json'); process.exit(2) }
    if (!feat.status) feat.status = 'pending'
    const i = s.features.findIndex(x => x.name === feat.name)
    if (i >= 0) s.features[i] = { ...s.features[i], ...feat }
    else s.features.push(feat)
    writeState(s)
    console.log(`feature "${feat.name}" upserted (status: ${feat.status})`)
    break
  }
  case 'mark-feature': {
    const s = readState()
    const feat = s.features.find(x => x.name === args.name)
    if (!feat) { console.error(`No feature named ${args.name}`); process.exit(2) }
    if (args.status) feat.status = args.status
    if (args.rounds !== undefined) feat.rounds = coerce(args.rounds)
    if (args['spec-path']) feat.specPath = args['spec-path']
    if (args['target-files']) feat.targetFiles = String(args['target-files']).split(',').map(x => x.trim())
    if (args.status === 'flagged' && !s.flagged.includes(args.name)) s.flagged.push(args.name)
    if (args.status === 'done') s.flagged = s.flagged.filter(n => n !== args.name)
    writeState(s)
    console.log(`feature "${args.name}" -> ${feat.status}`)
    break
  }
  case 'reconcile': {
    // Durable disk<->state sync. Run at resume so the loop never redoes finished
    // work and never silently trusts an unverified file. Rules in CODE, not
    // Manager discretion: fill specPath from disk (don't re-spec); mark
    // on-disk-but-unverified features 'built' (Tester re-validates, not a blind
    // rebuild); demote 'done'-without-file to 'pending'; rebase stale projectDir.
    const s = readState()
    const abs = path.resolve(dir)
    const featDir = s.paths?.features || 'docs/features'
    const changes = []
    if (s.projectDir && path.resolve(s.projectDir) !== abs) {
      changes.push(`projectDir: ${s.projectDir} -> ${abs} (rebased to actual location)`)
      s.projectDir = abs
    }
    for (const feat of s.features) {
      const fslug = (feat.name || '').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
      if (!feat.specPath) {
        const guess = path.join(featDir, fslug + '.spec.md')
        if (fs.existsSync(path.join(dir, guess))) { feat.specPath = guess; changes.push(`${feat.name}: specPath <- ${guess}`) }
      }
      if (!feat.briefPath) {
        const guess = path.join(featDir, fslug + '.brief.md')
        if (fs.existsSync(path.join(dir, guess))) { feat.briefPath = guess; changes.push(`${feat.name}: briefPath <- ${guess}`) }
      }
      const exists = fileExistsFor(feat)
      const hasDeclaredFiles = (feat.targetFiles && feat.targetFiles.length) || feat.targetFile
      // 'tested' = correctness verified, fun gate pending: preserve it so resume runs
      // the creative gate ONLY (don't knock it back to 'built' and re-test).
      if (feat.status === 'done' && hasDeclaredFiles && !exists) {
        feat.status = 'pending'; changes.push(`${feat.name}: done -> pending (target files missing on disk)`)
      } else if (feat.status === 'tested' && hasDeclaredFiles && !exists) {
        feat.status = 'pending'; changes.push(`${feat.name}: tested -> pending (target files missing on disk)`)
      } else if (!['done', 'tested', 'built'].includes(feat.status) && hasDeclaredFiles && exists) {
        const prev = feat.status; feat.status = 'built'
        changes.push(`${feat.name}: ${prev} -> built (files on disk, await Tester re-validation)`)
      }
    }
    writeState(s)
    console.log(`reconciled ${stateFile}`)
    if (changes.length) changes.forEach(c => console.log('  ' + c))
    else console.log('  (no changes — state already matches disk)')
    break
  }
  case 'remaining': {
    const s = readState()
    const remaining = s.features.filter(feat => {
      if (feat.status !== 'done') return true
      return !fileExistsFor(feat)
    })
    console.log(JSON.stringify(remaining, null, 2))
    break
  }
  default:
    console.error('Unknown command. See header of state.mjs for usage.')
    process.exit(2)
}
