export const meta = {
  name: 'game-build-team-recon',
  description:
    'Reconnaissance phase for the game-build-team skill — runs FIRST, before planning or building. Two read-only analysts in parallel: an ENVIRONMENT/TOOL-GAP audit (godot 4.x / node / adb / xvfb / $DISPLAY / vendored skills / host capacity → blockers the user must install) and a PROGRESS+REUSE audit (reads the durable resume doc for what is done vs left, and greps the existing game for systems to reuse so the plan never duplicates). Returns one structured report the Manager turns into a go/no-go and a pipeline plan. Writes ZERO code.',
  phases: [
    { title: 'Recon' },
  ],
}

// ---------------------------------------------------------------------------
// Phase 1 of the game-build-team phase machine. The Manager runs this BEFORE
// Phase 2 (plan) and Phase 3 (build/verify). It establishes the status quo so
// the plan is grounded in reality: what's installed, what's already built, and
// what existing systems to reuse. If it returns blockers, the Manager surfaces
// "install X first" to the user and does NOT proceed to build until resolved.
//
// Read-only by design: the analysts probe (`--version`, `which`, `--check`,
// `status`) and grep; they never install, build, or mutate the project.
//
// `args` (passed by the Manager from .game-build-team/state.json):
//   {
//     goal:        string,
//     featureRequest: string,              // what the user asked for, to target the reuse grep
//     projectDir:  string,                 // absolute path to the Godot project
//     godotBin:    string,                 // path to the godot binary (default 'godot')
//     designRefs:  string,                 // dir of design-contract refs
//     personas:    { recon? },             // canonical text from agents/recon-analyst.md
//     paths:       { statePath, reportPath, skillDir }
//   }
// ---------------------------------------------------------------------------

let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { A = { __argsParseError: String(e && e.message || e) } }
}
if (Array.isArray(A) || typeof A !== 'object' || A === null) A = { __argsShapeError: `args was ${Array.isArray(A) ? 'an array' : typeof A}` }

const goal = A.goal || 'Recon the project + environment before building.'
const featureRequest = A.featureRequest || goal
const projectDir = A.projectDir || '.'
const godotBin = A.godotBin || 'godot'
const designRefs = A.designRefs || 'graphify-out'
const statePath = A.paths?.statePath || ''
const reportPath = A.paths?.reportPath || ''
const skillDir = A.paths?.skillDir || ''
const model = A.runConfig?.modelTier === 'cost-optimized' || A.runConfig?.modelTier === 'ultra-cheap' ? 'sonnet' : 'opus'

log(`recon config: projectDir=${projectDir} | godot=${godotBin} | feature="${featureRequest.slice(0, 60)}" | statePath=${statePath ? 'set' : 'none'}`)
if (A.__argsParseError || A.__argsShapeError) {
  log(`ABORT: args not usable (${A.__argsParseError || A.__argsShapeError}).`)
  return { error: 'bad-args', ready: false, blockers: [{ item: 'args', detail: A.__argsParseError || A.__argsShapeError, fix: 'pass a real object or JSON string' }] }
}

const RECON_PERSONA = A.personas?.recon || `You are the RECON ANALYST on a Godot 4 game team — read-only eyes on the ground, running before any planning or building. You write ZERO code; your Bash is for read-only inspection only (--version, which, --check, status) and grep. You report the STATUS QUO honestly so the Manager plans from reality. Load godot-project-setup (installed locally from source by preflight). A companion skill not installed is a BLOCKER, never a degrade — the team has no fallback. NEVER install anything yourself, NEVER guess progress (it comes only from the durable resume doc on disk), NEVER downgrade a hard blocker to a warning, NEVER recommend duplicating a system that already exists.`

// --- Structured output schemas ---------------------------------------------

const ENV_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['ready', 'blockers', 'degraded'],
  properties: {
    ready: { type: 'boolean', description: 'false if ANY blocker exists' },
    blockers: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['item', 'detail', 'fix'],
        properties: {
          item: { type: 'string', description: 'the missing/wrong tool (e.g. "godot 4.x", "node")' },
          detail: { type: 'string', description: 'why it blocks the run' },
          fix: { type: 'string', description: 'the exact action the user must take' },
        },
      },
    },
    degraded: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['item', 'impact'],
        properties: {
          item: { type: 'string' },
          impact: { type: 'string', description: 'the named limitation the run proceeds with' },
        },
      },
    },
    capacity: {
      type: 'object', additionalProperties: false,
      properties: { waveSize: { type: 'integer', description: 'safe parallel feature count from capacity.mjs' } },
    },
    notes: { type: 'string' },
  },
}

const PROGRESS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['fresh', 'progress', 'reuse'],
  properties: {
    fresh: { type: 'boolean', description: 'true if no prior state file (nothing built yet)' },
    progress: {
      type: 'object', additionalProperties: false,
      properties: {
        phase: { type: 'string' },
        done: { type: 'array', items: { type: 'string' } },
        tested: { type: 'array', items: { type: 'string' } },
        built: { type: 'array', items: { type: 'string' } },
        pending: { type: 'array', items: { type: 'string' } },
        flagged: { type: 'array', items: { type: 'string' } },
      },
    },
    reuse: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['system', 'path', 'note'],
        properties: {
          system: { type: 'string', description: 'existing system/autoload/helper that owns the concern' },
          path: { type: 'string', description: 'where it lives' },
          note: { type: 'string', description: 'how the plan should extend it (not duplicate)' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

// --- The recon sweep: two analysts in parallel, then merge -----------------
// A barrier is correct here: the Manager needs BOTH the env verdict and the
// progress/reuse map together to gate the run and write the plan.

const envPrompt = `${RECON_PERSONA}

## Task: ENVIRONMENT + TOOL-GAP AUDIT (the go/no-go)
Probe the host read-only, in ONE pass, and classify each finding as blocker / degraded / ready:
1. \`${godotBin} --version\` — present AND Godot 4.x? (missing or 3.x = BLOCKER, fix = "install Godot 4.x on PATH").
2. \`node --version\` — present? (missing = BLOCKER; state/report/capacity scripts need it).
3. Visual gating: run \`which adb\`; if none, check \`$DISPLAY\`; if none, \`which xvfb-run\`. If NONE of the three exist → DEGRADED (tests still gate; screenshot QA limited — say so).
4. Companion skills: \`bash ${skillDir ? skillDir + '/scripts/install-deps.sh' : '<skillDir>/scripts/install-deps.sh'} --dir ${projectDir} --check\` — it exits non-zero and lists any not installed. ANY missing companion skill is a BLOCKER (fix = run install-deps.sh --dir ${projectDir} to install from source), NEVER degraded — the team has no fallback.
5. Capacity: \`node ${skillDir ? skillDir + '/scripts/capacity.mjs' : '<skillDir>/scripts/capacity.mjs'} --wave\` — report the safe waveSize.
Give every blocker an exact \`fix\`. Set ready=false if ANY blocker exists. Return the ENV_SCHEMA object.`

const progressPrompt = `${RECON_PERSONA}

## Task: PROGRESS + REUSE AUDIT (what's done vs left, and what to reuse)
Requested feature(s): "${featureRequest}". Design contract: ${designRefs}.
1. PROGRESS — read the durable resume doc:
   - \`node ${statePath || '<statePath>'} status --dir ${projectDir}\` (or read ${projectDir}/.game-build-team/state.json). Report the phase and each feature's status: done / tested / built / pending / flagged.
   - If ${projectDir}/.game-build-team/report.json exists, read it for prior gate verdicts + open issues.
   - If there is NO state file, set fresh=true and report empty progress lists ("fresh run").
2. REUSE — grep ${projectDir} for existing systems that already own the concern(s) the requested feature needs (autoloads, singletons, class_name systems, signal buses, save/economy/grid helpers). Name each with its path and a one-line note on how the plan should EXTEND it rather than duplicate. Flag anything the feature would otherwise re-implement.
Return the PROGRESS_SCHEMA object.`

const [env, prog] = await parallel([
  () => agent(envPrompt, { label: 'recon:environment', phase: 'Recon', schema: ENV_SCHEMA, model }),
  () => agent(progressPrompt, { label: 'recon:progress+reuse', phase: 'Recon', schema: PROGRESS_SCHEMA, model }),
])

// --- Merge into one report + an honest recommendation ----------------------
const blockers = (env && env.blockers) || []
const degraded = (env && env.degraded) || []
const ready = !!(env && env.ready) && blockers.length === 0

let recommendation
if (!env || !prog) {
  recommendation = 'recon incomplete — an analyst failed; re-run recon before planning.'
} else if (blockers.length) {
  recommendation = `BLOCKED — surface to the user and do NOT build until resolved: ${blockers.map(b => b.item).join(', ')}.`
} else if (degraded.length) {
  recommendation = `proceed-degraded — plan the run, but note: ${degraded.map(d => d.item).join(', ')}.`
} else {
  recommendation = 'proceed — environment ready; plan the pipeline from progress + reuse below.'
}

const report = {
  ready,
  blockers,
  degraded,
  progress: (prog && prog.progress) || { phase: 'setup', done: [], tested: [], built: [], pending: [], flagged: [] },
  fresh: prog ? !!prog.fresh : true,
  reuse: (prog && prog.reuse) || [],
  capacity: (env && env.capacity) || {},
  recommendation,
}

log(`recon done: ready=${report.ready} | blockers=${blockers.length} | degraded=${degraded.length} | done=${report.progress.done.length} | pending=${report.progress.pending.length} | reuse=${report.reuse.length}`)
return report
