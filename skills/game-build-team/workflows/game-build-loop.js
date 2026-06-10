export const meta = {
  name: 'game-build-team-loop',
  description:
    'Autonomous, resumable Godot feature-build loop. Per feature: brief (Creative Director) -> build logic (Logic Developer) -> juice pass (Animation Developer) -> TEST GATE (Tester: headless suite + screenshot + invariants) -> CREATIVE GATE (Creative Director: does it feel like the brief?). Both gates are control flow, not discretion — a feature does not advance until both pass. Optional docs track + final full-suite regression. Built for the game-build-team skill. Godot 4 / GDScript, mobile.',
  phases: [
    { title: 'Brief' },
    { title: 'Logic' },
    { title: 'Animation' },
    { title: 'Test Gate' },
    { title: 'Creative Gate' },
    { title: 'Docs' },
    { title: 'Final Regression' },
  ],
}

// ---------------------------------------------------------------------------
// ENFORCEMENT ENGINE for the game-build-team skill. The Manager (main thread)
// cannot reorder or skip these steps — they are control flow here, not
// discretion. Every feature passes TWO gates before it counts as done:
//   1) TEST GATE  (Tester): headless GDScript suite green + zero parse/script
//      errors + screenshot checked against the design contract + invariants intact.
//   2) CREATIVE GATE (Creative Director): the running feature feels like the brief
//      intended (readable / responsive / satisfying / on-theme / fair).
// Per feature the pipeline is: brief -> [logic build -> animation pass -> test gate
//   -> creative gate] looped on NG until both OK or the round cap.
// After all features pass, an optional final full-suite + boot-smoke regression
// gates the whole run.
//
// DYNAMIC, not just deterministic: the STEP ORDER is fixed, but how many features
// build in parallel is `runConfig.waveSize`, which the Manager sizes to the host
// via scripts/capacity.mjs so a tight box never gets OOM-killed.
//
// Adapted from clone-team's clone-build-loop.js. Kept: robust args intake, config
// echo + fail-fast, per-feature loop with round caps, waves, durable resume via
// state.mjs, final regression. The WEB layer (agent-browser, CSS motion) is gone;
// verification is Godot-native (references/godot-verify-playbook.md). The motion
// pipeline is reframed for game-feel: Motion Analyst -> Creative Director (brief +
// fun gate), Motion Developer -> Animation Developer (juice pass on the same files).
//
// `args` (passed by the Manager from .game-build-team/state.json):
//   {
//     goal:        string,
//     projectDir:  string,                 // absolute path to the Godot project (has project.godot)
//     godotBin:    string,                 // path to the godot binary (default 'godot')
//     designRefs:  string,                 // dir of design-contract refs (graphify-out/, mockup PNGs)
//     projectInvariants: string,           // the project's laws, extracted from its contract by the Manager
//     features:    Array<{
//        name, designRef?, complexity?, dependsOn?, targetFiles?: string[],
//        briefPath?, specPath?, status?     // 'done' skip; 'tested' creative-gate-only; 'built' test-first
//     }>,
//     runConfig:   { modelTier, maxRounds, finalCap, docsDepth, waveSize, skipFinal, animationPass, creativeGate },
//     personas:    { creative?, logic?, animation?, tester?, docs? }  // canonical text from agents/*.md
//     paths:       { features, verifyScript, statePath, reportPath, skillDir }
//   }
// Anything missing falls back to a sensible default.
// ---------------------------------------------------------------------------

let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { A = { __argsParseError: String(e && e.message || e) } }
}
if (Array.isArray(A) || typeof A !== 'object' || A === null) A = { __argsShapeError: `args was ${Array.isArray(A) ? 'an array' : typeof A}` }

const goal = A.goal || 'Build the requested feature(s) to the project design contract, fully verified and fun.'
const projectDir = A.projectDir || '.'
const godotBin = A.godotBin || 'godot'
const designRefs = A.designRefs || 'graphify-out'
const featuresDir = A.paths?.features || 'docs/features'
const verifyScript = A.paths?.verifyScript || ''
const statePath = A.paths?.statePath || ''
const reportPath = A.paths?.reportPath || ''
const skillDir = A.paths?.skillDir || ''

const cfg = A.runConfig || {}
const maxRounds = Number.isFinite(cfg.maxRounds) ? cfg.maxRounds : 4
const finalCap = Number.isFinite(cfg.finalCap) ? cfg.finalCap : 3
const docsDepth = cfg.docsDepth || 'none' // 'none' | 'note' | 'sync'
const waveSize = Number.isFinite(cfg.waveSize) && cfg.waveSize > 0 ? cfg.waveSize : 9999
const skipFinal = !!cfg.skipFinal
const animationPass = cfg.animationPass !== false // default ON — the juice pass
const creativeGate = cfg.creativeGate !== false   // default ON — the fun gate

// Model tier -> per-role model. Manager runs in the main thread (session model).
const TIERS = {
  'max-fidelity':   { creative: 'opus',   logic: 'opus',   animation: 'opus',   tester: 'opus',   docs: 'opus'   },
  'cost-optimized': { creative: 'sonnet', logic: 'sonnet', animation: 'sonnet', tester: 'sonnet', docs: 'sonnet' },
  'ultra-cheap':    { creative: 'sonnet', logic: 'sonnet', animation: 'haiku',  tester: 'haiku',  docs: 'haiku'  },
}
const M = TIERS[cfg.modelTier] || TIERS['max-fidelity']

const features = (A.features || []).filter(Boolean)

// --- Startup config echo + fail-fast guard ---------------------------------
log(`game-build-team config: projectDir=${projectDir} | godot=${godotBin} | tier=${cfg.modelTier || 'max-fidelity'} | features=${features.length} | waveSize=${waveSize >= 9999 ? 'all' : waveSize} | animationPass=${animationPass} | creativeGate=${creativeGate} | skipFinal=${skipFinal} | docs=${docsDepth}`)
if (A.__argsParseError || A.__argsShapeError) {
  log(`ABORT: args not usable (${A.__argsParseError || A.__argsShapeError}). Pass a real object OR a JSON string for \`args\`.`)
  return { error: 'bad-args', detail: A.__argsParseError || A.__argsShapeError, summary: { features: 0, passed: 0, flagged: [], finalVerdict: 'not-run' } }
}
if (features.length === 0) {
  log('ABORT: 0 features to build. Launch misconfiguration (args.features empty or not delivered) — NOT a successful empty run. Fix args and relaunch.')
  return { error: 'no-features', summary: { features: 0, passed: 0, flagged: [], finalVerdict: 'not-run' }, hint: 'Pass args.features as a non-empty array.' }
}

// --- Project invariants: the Manager extracts these from THIS game's design
// contract and passes them in. No game's vocabulary is hardcoded here. The
// generic fallback still enforces the universal laws if the Manager passed none.
const PROJECT_LAWS = A.projectInvariants || `PROJECT INVARIANTS (non-negotiable — a violation is an automatic NG):
- DRY / reuse, never duplicate: every recurring shape lives in ONE module (autoload/system/helper). GREP before writing; extend, never re-roll. Reuse the project's existing foundation systems.
- Single authority per concern: each concern (entity kind, hit-testing, coordinate transforms, containment/numbering, blocking modals) has exactly one owner module — route through it, never re-implement it in a feature file.
- Clean up, don't stack: when you change behavior, DELETE the old path — no forks, no orphan helpers, no dead constants.
- Match the design contract: palette, layout, framing, vocabulary, and target device come from the contract — read them, never invent values it fixes.`

// --- Role capsules (defaults; canonical full versions in agents/*.md, passed by
// the Manager via args.personas) --------------------------------------------

const CREATIVE_PERSONA = A.personas?.creative || `You are the CREATIVE DIRECTOR on a Godot 4 game team — a game-design + UX lead. You do NOT write gameplay code. You run FIRST (author the feature BRIEF: player experience, interaction model, the game-feel/juice plan, and fun acceptance criteria) and LAST (the FUN GATE: does the running feature feel like the brief intended?). Load godot-brainstorming / brainstorming / emil-design-eng / 2d-essentials (installed locally from source on init — no fallback); your craft reference is ${skillDir ? skillDir +'/references/game-feel.md' : "references/game-feel.md"}. Realize the game's LOCKED identity from the design contract (${designRefs}), not your own taste. ${PROJECT_LAWS}`

const LOGIC_PERSONA = A.personas?.logic || `You are the LOGIC DEVELOPER on a Godot 4 / GDScript game team — the systems build machine. You implement a feature's LOGIC (state, rules, economy, simulation, data, input) from the brief + spec against the design contract (${designRefs}), reusing existing autoloads/systems rather than duplicating them. Load gdscript-patterns / state-machine / event-bus / component-system / save-load / clean-code / clean-architecture (installed locally from source on init — no fallback). Always ground in the existing code + contract — never guess. You leave the files clean for the Animation Developer to add juice on top. ${PROJECT_LAWS}
You NEVER guess a value the spec should contain. You make the GDScript PARSE and the test suite pass before reporting, with tests that exercise the REAL call path/timing (not a hand-seeded fixture that masks an autoload/tree-timing bug). You report honest notes including anything you could not verify.`

const ANIMATION_PERSONA = A.personas?.animation || `You are the ANIMATION DEVELOPER on a Godot 4 game team — the juice / game-feel engineer. You run a SEQUENTIAL polish pass AFTER the Logic Developer, editing the SAME files to add feel/feedback ONLY (tweens, AnimationPlayer, GPUParticles, camera shake/zoom, shaders, hit-flash, sfx hooks) — you NEVER change logic, state, economy values, or layout (if a change alters what the feature does or where things sit, you've overstepped — flag it for the Manager). Load tween-animation / animation-system / particles-vfx / camera-system / shader-basics / emil-design-eng (installed locally from source on init — no fallback); your craft reference is ${skillDir ? skillDir +'/references/game-feel.md' : "references/game-feel.md"}. Build every juice moment in the brief; ease-out arrivals, snappy timing, trauma-based capped screen shake; respect the game's reduced-motion setting; pool particles. Keep the suite green (\`bash ${verifyScript || '<verifyScript>'} --dir ${projectDir} --tests-only\`). Confirm each behavior actually fires on the running game. Report exactly which juice you added by brief moment.`

const TESTER_PERSONA = A.personas?.tester || `You are the TESTER on a Godot 4 game team — the CORRECTNESS gate. You verify by OBSERVATION, never by trusting a developer's report. Load godot-testing / godot-code-review / godot-debugging (installed locally from source on init — no fallback); your verify recipe is ${skillDir ? skillDir +'/references/godot-verify-playbook.md' : "references/godot-verify-playbook.md"}. Every round run a FULL regression, not a spot check: \`bash ${verifyScript || '<verifyScript>'} --dir ${projectDir}\` (headless GDScript suite MUST exit 0 with ZERO parse/script errors), confirm each acceptance criterion has a REAL assertion ON THE REAL CALL PATH/TIMING (a test whose pass doesn't depend on the real autoloads/signals/frames is an NG — it can hide a tree-timing bug), open the captured screenshot and check the running game against the design contract (${designRefs}), and confirm the PROJECT INVARIANTS hold. The verify script prints \`SCREENSHOT SOURCE: deploy-fresh | source-render | none\`; default is a FRESH source-render of the code just written, and you may pass \`--deploy\` to build+install+launch the fresh APK on the real device yourself and screencap it (an ordinary shell command, NOT Manager-only). Record \`visual\` to match the source (deploy-fresh→VERIFIED-ON-DEVICE, source-render→VERIFIED-SOURCE-RENDER, none→UNVERIFIED+flag); NEVER report a source-render as on-device and NEVER let a stale/missing frame pass. ${PROJECT_LAWS}
Do NOT stop at the first failure — accumulate the COMPLETE punch list in one pass. Return OK only if suite green AND screen matches AND invariants intact; otherwise NG with specific, reproducible issues. (Feel is the Creative Director's gate — you own correctness.)`

const DOCS_PERSONA = A.personas?.docs || `You are the DOMAIN ARCHITECT on a Godot game team. Your deliverable is DOCUMENTATION, not code. You produce a concise feature-impact note (what changed, which systems/autoloads touched, which design decisions it realizes or contradicts) so the project's living docs stay coherent. You READ the design contract (${designRefs}) but you DO NOT edit the user's canonical docs unless told. Flag any drift between the build and the locked decisions for the Manager.`

// --- Structured output schemas ---------------------------------------------

const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['featureName', 'briefPath', 'ready'],
  properties: {
    featureName: { type: 'string' },
    briefPath: { type: 'string', description: 'path to the written .brief.md' },
    interactionModel: { type: 'string', description: 'how input maps to action on this game surface' },
    juiceMoments: { type: 'integer', description: 'count of feedback/juice moments planned for the Animation Developer' },
    reusedFeel: { type: 'array', items: { type: 'string' }, description: 'existing feel-language/systems this should match' },
    ready: { type: 'boolean', description: 'true if the brief is complete enough to build + judge fun from' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    wrappedUp: { type: 'boolean', description: 'true if you stopped early due to a WRAP_UP/HARD_STOP sentinel' },
    handoffPath: { type: 'string', description: 'path to the handoff report written when wrapping up' },
  },
}

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['featureName', 'filesWritten', 'parses', 'testsPass', 'summary'],
  properties: {
    featureName: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    parses: { type: 'boolean', description: 'GDScript parses with no errors' },
    testsPass: { type: 'boolean', description: 'headless test suite exits 0' },
    deletedOldPath: { type: 'boolean', description: 'old/replaced code paths removed (clean-up-don\'t-stack)' },
    summary: { type: 'string' },
    devNotes: { type: 'string', description: 'honest notes: what was done, what is uncertain, what was inferred' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    wrappedUp: { type: 'boolean', description: 'true if you stopped early due to a WRAP_UP/HARD_STOP sentinel' },
    handoffPath: { type: 'string', description: 'path to the handoff report written when wrapping up' },
  },
}

// Shared by BOTH gates (test + creative): same shape so the loop feeds either
// gate's issues straight back to a developer.
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scope', 'verdict', 'issues'],
  properties: {
    scope: { type: 'string', description: 'what was reviewed' },
    verdict: { type: 'string', enum: ['OK', 'NG'] },
    suiteGreen: { type: 'boolean', description: '(test gate) headless suite exited 0 with zero parse/script errors' },
    screenshotRef: { type: 'string', description: 'path to the screenshot reviewed this round' },
    visual: { type: 'string', enum: ['VERIFIED-ON-DEVICE', 'VERIFIED-SOURCE-RENDER', 'UNVERIFIED'], description: 'fidelity of the visual check, matching the verify script\'s SCREENSHOT SOURCE (deploy-fresh / source-render / none)' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'area', 'description', 'expected', 'actual'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string' },
          description: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          repro: { type: 'string' },
          screenshotRef: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
    wrappedUp: { type: 'boolean', description: 'true if you stopped early due to a WRAP_UP/HARD_STOP sentinel' },
    handoffPath: { type: 'string', description: 'path to the handoff report written when wrapping up' },
  },
}

const DOC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['docPath', 'coverage'],
  properties: {
    docPath: { type: 'string' },
    featuresCovered: { type: 'array', items: { type: 'string' } },
    coverage: { type: 'string', enum: ['partial', 'substantial', 'complete'] },
    driftFlags: { type: 'array', items: { type: 'string' }, description: 'where the build contradicts a locked decision' },
    wrappedUp: { type: 'boolean', description: 'true if you stopped early due to a WRAP_UP/HARD_STOP sentinel' },
    handoffPath: { type: 'string', description: 'path to the handoff report written when wrapping up' },
  },
}

// --- Prompt builders --------------------------------------------------------

const slug = (n) => (n || 'feature').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const briefPathFor = (f) => `${featuresDir}/${slug(f.name)}.brief.md`
const specPathFor = (f) => `${featuresDir}/${slug(f.name)}.spec.md`

const sentinelDir = `${projectDir}/.game-build-team`

const CONTEXT = `## Shared context
- GOAL: ${goal}
- PROJECT DIR: ${projectDir} (Godot 4 / GDScript, mobile, isometric)
- DESIGN CONTRACT: ${designRefs} (read it FIRST; plus any mockup PNGs)
- Feature docs dir: ${featuresDir}
- Godot binary: ${godotBin}
- Verify script (suite + screenshot): ${verifyScript || '(ask the Manager)'}${skillDir ? `\n- Skill dir: ${skillDir} (verify recipe in references/godot-verify-playbook.md; juice taxonomy in references/game-feel.md)` : ''}

## Usage wrap-up protocol (mandatory — the account's usage window may run out mid-run)
A watchdog may write sentinel files when the usage window nears its cap. CHECK for them at the START of your task and again BETWEEN major steps — a free file-existence test, e.g. \`ls ${sentinelDir}/WRAP_UP ${sentinelDir}/HARD_STOP 2>/dev/null\`:
- Sentinel present when you START → do NO work; return immediately with \`wrappedUp: true\` (fill required result fields honestly: empty lists, false flags, summary "wrapped up before starting").
- \`HARD_STOP\` appears mid-task → STOP immediately, even mid-step. Write your handoff NOW with whatever you have, then return.
- \`WRAP_UP\` appears mid-task → start NO new major step. Finish the current atomic step only if it is minutes from done, write your handoff, then return.
HANDOFF = write \`${featuresDir}/<feature-slug>.handoff.md\` (for non-feature tasks use a task slug, e.g. \`final-regression\`): TARGET (what you were asked to do), DONE (what is complete, with file paths), REMAINING (what is not), NEXT STEP (the exact first action for whoever resumes), plus any open punch list. Flush ALL in-context findings into it — anything not on disk is lost at cutoff. Then set \`wrappedUp: true\` and \`handoffPath\` in your structured result.`

// Helper: render an issue list (used in fix rounds, from either gate).
const renderIssues = (issues) => (issues || []).map((i, n) => `${n + 1}. [${i.severity}] ${i.area}: ${i.description}\n   expected: ${i.expected}\n   actual: ${i.actual}${i.repro ? `\n   repro: ${i.repro}` : ''}`).join('\n')

const briefPrompt = (f) => `${CREATIVE_PERSONA}

${CONTEXT}

## Task: author the BRIEF for ONE feature — "${f.name}"
You are NOT building. Read the design contract (${designRefs}) and the EXISTING game, then write the creative brief a team can build a *fun* feature from with zero guessing:
- PLAYER EXPERIENCE (what they do, feel, why it's fun),
- INTERACTION MODEL (exactly how input maps to action on this game's surface — be specific; match the existing game),
- GAME-FEEL / JUICE PLAN (the feedback budget: for each meaningful action + simulation event, the visual+audio+motion reaction the Animation Developer must build),
- FUN ACCEPTANCE CRITERIA (observable, gate-able — what you will grade at the creative gate),
- REUSE + FIT (existing systems/feel-language to match so it feels native).
Write the brief to \`${briefPathFor(f)}\`. Flag anything that would clash with a locked decision as an open question. Return the structured result.${f.handoffPath ? `\nA prior run WRAPPED UP early on this feature — read the handoff at \`${f.handoffPath}\` FIRST and continue from its NEXT STEP; do not redo anything its DONE list covers.` : ''}`

const logicPrompt = (f, brief, testVerdict, creativeVerdict, lastBuild) => `${LOGIC_PERSONA}

${CONTEXT}

## Task: BUILD the LOGIC of feature "${f.name}"${f.targetFiles?.length ? ` (target files: ${f.targetFiles.join(', ')})` : ''}
${f.handoffPath ? `A prior run WRAPPED UP early on this feature — read the handoff at \`${f.handoffPath}\` FIRST and continue from its NEXT STEP; do not redo anything its DONE list covers.\n` : ''}Read the brief at \`${brief?.briefPath || briefPathFor(f)}\`${f.specPath ? ` and the spec at \`${f.specPath}\`` : ''} and build EXACTLY to them. REUSE the systems they list — grep before writing any new helper; extend, never duplicate. When you change behavior, DELETE the old path. Add/update the feature's tests under \`tests/unit/\` (\`extends SceneTree\`, run via \`godot --headless --script res://tests/...\`) with REAL assertions on the real call path. Make GDScript PARSE and the suite pass before reporting (\`bash ${verifyScript || '<verifyScript>'} --dir ${projectDir} --tests-only\`). Leave clean nodes/signals for the Animation Developer to hook feedback onto.
**VISUAL DRIVER (so the gate sees the feature, not a boot frame):** also write \`tests/visual/drive_${slug(f.name)}.gd\` — an \`extends SceneTree\` that loads the main scene, drives THIS feature to its key interaction state from the brief (e.g. place a few objects / enter the relevant mode — reuse the same real input/API path the game uses, no shortcuts), awaits a handful of frames to settle, saves the framebuffer to \`OS.get_environment("GBT_SHOT_OUT")\` via \`get_root().get_texture().get_image().save_png(...)\`, then \`quit()\`. If on-device taps are meaningful, also write \`tests/visual/drive_${slug(f.name)}.adb.sh\` (a few \`adb shell input tap/swipe\` lines; \`$GBT_DEVICE\` is the serial). The verify script auto-loads these by slug — without them the gate only sees a resting frame.
${(testVerdict?.verdict === 'NG' || creativeVerdict?.verdict === 'NG') ? `\n## FIX round. Address EVERY issue below with full context of your last build:\n### Your previous notes\n${lastBuild?.devNotes || lastBuild?.summary || '(none)'}\n${testVerdict?.verdict === 'NG' ? `### TEST-GATE issues (correctness — yours to fix)\n${renderIssues(testVerdict.issues)}\n${testVerdict.suiteGreen === false ? 'The SUITE WAS RED — getting it green is priority #1.\n' : ''}` : ''}${creativeVerdict?.verdict === 'NG' ? `### CREATIVE-GATE issues (fun — fix any rooted in logic/structure; pure feel goes to the Animation Developer)\n${renderIssues(creativeVerdict.issues)}\n` : ''}` : ''}
Return the structured build result with honest devNotes.`

const animationPrompt = (f, brief, testVerdict, creativeVerdict, lastBuild) => `${ANIMATION_PERSONA}

${CONTEXT}

## Task: JUICE PASS on "${f.name}"${f.targetFiles?.length ? ` in ${f.targetFiles.join(', ')}` : ''} (sequential — AFTER the logic build, BEFORE the gates)
The Logic Developer just built/updated this feature. Read the brief's GAME-FEEL / JUICE PLAN at \`${brief?.briefPath || briefPathFor(f)}\` and implement EVERY feedback moment the current build is missing or has wrong — WITHOUT changing logic, state, economy values, or layout (those are the Logic Developer's gated scope; you ONLY add/repair feel). Wire taps/selection pops, grid-placement settle+dust, invalid-action feedback (never a silent no-op), resource-gain counter tweens + floating numbers, upgrade/level-up bursts + camera punch, simulation-tick staggered propagation, damage shake + hitstop, and screen transitions. Apply consistent easing/timing; gate non-essential motion behind the reduced-motion setting; pool particles. DRIVE/confirm each fires on the running game. Keep the suite green.
${creativeVerdict?.verdict === 'NG' ? `\n## Fix round — the CREATIVE gate returned NG. Own the FEEL issues below (leave pure logic/layout to the Logic Developer):\n${renderIssues(creativeVerdict.issues)}\n` : ''}${testVerdict?.verdict === 'NG' ? `\n## Note: the TEST gate also returned NG; the Logic Developer is fixing correctness. Re-apply/repair your juice on top of their fix.\n` : ''}
Return the structured build result listing exactly which juice you added/fixed by brief moment.`

const testPrompt = (f, brief, build, finalGate) => `${TESTER_PERSONA}

${CONTEXT}

## Task: TEST GATE (full regression) of feature "${f.name}" — correctness before it advances
The developers report: ${build?.summary || '(no summary)'} — files: ${(build?.filesWritten || []).join(', ') || '(none)'}.
Reference brief: \`${brief?.briefPath || briefPathFor(f)}\`${f.specPath ? `; spec: \`${f.specPath}\`` : ''}.
Run the gate, accumulating EVERY defect in one pass (never short-circuit):
1. SUITE + SCREENSHOT: \`bash ${verifyScript || '<verifyScript>'} --dir ${projectDir} --feature "${slug(f.name)}"\` (add \`--deploy\` for on-device truth) — headless GDScript suite MUST exit 0 with ZERO "Parse Error" / "SCRIPT ERROR". Red suite = automatic NG (suiteGreen=false). \`--feature\` auto-loads the Logic Developer's \`tests/visual/drive_${slug(f.name)}.gd\` so the captured frame shows the feature mid-interaction, not a boot frame; if the script logs "no driver … RESTING boot frame", treat a feature that needs interaction as visually under-verified and say so.
2. COVERAGE: each acceptance criterion in the brief/spec has a REAL test assertion (not a stub) that exercises the REAL call path/timing — a test whose pass doesn't depend on the real autoloads/signals/frames is an NG (it can hide a tree-timing bug), not coverage.
3. SCREENSHOT: default is a FRESH source-render of the code just written; pass \`--deploy\` to instead build+install+launch the fresh APK on the real device and screencap it (you may do this — it's an ordinary shell command). The script prints \`SCREENSHOT SOURCE\`. Open the frame; check the running game vs the design contract (${designRefs}) — layout, palette, framing, the feature actually visible/working. Off-spec or static-where-it-renders = NG. Set screenshotRef AND set visual to match the source (deploy-fresh→VERIFIED-ON-DEVICE, source-render→VERIFIED-SOURCE-RENDER, none→UNVERIFIED). NEVER report a source-render as on-device; if no frame, mark UNVERIFIED and flag it — never a silent pass.
4. INVARIANTS: confirm no project law is broken. A violation is an automatic NG.
Return verdict OK only if suite green AND screen matches AND invariants intact; otherwise NG with specific, reproducible issues.
${reportPath ? `\n## RESULTS RECORD (EVERY round — OK or NG — BEFORE you return)\nPersist this round's outcome so it survives the Workflow's ephemeral return:\n\`node ${reportPath} append-round --dir ${projectDir} --feature "${f.name}" --round <this round> --gate test --verdict <OK|NG> --issues-json '<your issues array as JSON, [] if none>'${'`'} (add ${'`'}--screenshot <screenshotRef>${'`'} when you captured a frame). This records the test gate regardless of verdict.\n` : ''}${statePath ? `\n## DURABLE CHECKPOINT (mandatory on OK — BEFORE you return)\nThe moment your verdict is OK, run exactly:\n\`node ${statePath} mark-feature --dir ${projectDir} --name "${f.name}" --status ${finalGate ? 'done' : 'tested'} --rounds <the round you approved>\`\n${finalGate ? 'This is the FINAL gate for this run (creative gate disabled), so it marks the feature done.' : 'This marks the feature `tested` (correctness verified). It flips to `done` only after the Creative gate also passes.'} NEVER run it on NG.\n` : ''}`

const creativePrompt = (f, brief, build, testVerdict) => `${CREATIVE_PERSONA}

${CONTEXT}

## Task: CREATIVE GATE (the FUN gate) of feature "${f.name}" — it passed correctness; does it FEEL right?
The Test gate is OK: suite green, screen matches the contract. Now judge the RUNNING feature (from the screenshot at \`${testVerdict?.screenshotRef || '(the latest verify capture)'}\` and the build notes: ${build?.summary || '(none)'}) against YOUR brief at \`${brief?.briefPath || briefPathFor(f)}\` using the rubric in ${skillDir ? skillDir + '/references/game-feel.md' : 'references/game-feel.md'}:
1. READABLE — can the player instantly tell what happened + whether it worked?
2. RESPONSIVE — does every action have immediate feedback (no dead taps)?
3. SATISFYING — does the core action have weight/pop proportional to its importance?
4. ON-THEME — does the feel match the game's identity (design contract)?
5. FAIR — failures communicate clearly; nothing punishes silently.
A miss on READABLE / RESPONSIVE / FAIR is a creative NG (real feel defect). Grade SATISFYING / ON-THEME against the brief's stated ambition, not personal taste. Return verdict OK only if the feature delivers the fun the brief promised; otherwise NG with specific, reproducible issues (same shape as a Tester issue) the Animation/Logic Developer can fix directly.
${reportPath ? `\n## RESULTS RECORD (EVERY round — OK or NG — BEFORE you return)\nPersist the fun verdict so it survives the Workflow's ephemeral return:\n\`node ${reportPath} append-round --dir ${projectDir} --feature "${f.name}" --round <this round> --gate creative --verdict <OK|NG> --issues-json '<your issues array as JSON, [] if none>'${'`'}. On OK this records the feature fully \`done\` in the report.\n` : ''}${statePath ? `\n## DURABLE CHECKPOINT (mandatory on OK — BEFORE you return)\nThe moment your verdict is OK (BOTH gates now pass), run exactly:\n\`node ${statePath} mark-feature --dir ${projectDir} --name "${f.name}" --status done --rounds <the round you approved>\`\nThis is what flips the feature to fully \`done\` and makes the run resumable. NEVER run it on NG.\n` : ''}`

const docsPrompt = () => `${DOCS_PERSONA}

${CONTEXT}

## Task: feature-impact documentation (depth: ${docsDepth})
Write \`${featuresDir}/IMPACT.md\`: for each feature built this run — what changed, which systems/autoloads it touched, which locked decision it realizes, and any DRIFT from the locked decisions in ${designRefs}. ${docsDepth === 'sync' ? 'Additionally, DRAFT (do NOT commit) suggested decision-log append lines for the Manager to review with the user.' : 'Stay at a concise impact note; do not edit the user\'s canonical docs.'} Return the structured doc result with any driftFlags.`

const finalPrompt = (results, finalVerdict, round) => `${TESTER_PERSONA}

${CONTEXT}

## Task: FINAL FULL-SUITE REGRESSION (round ${round}) — the last automated gate
All features passed both gates individually. Now verify the whole game still coheres:
1. Run the COMPLETE suite: \`bash ${verifyScript || '<verifyScript>'} --dir ${projectDir}\` — must exit 0, zero parse/script errors across ALL tests (a fix to one feature can break another).
2. BOOT SMOKE: confirm the main scene loads without error and the captured screenshot shows the expected game screen against the design contract.
3. Spot-check the project invariants across the features built this run: ${results.filter(Boolean).map(r => r.feature).join(', ')}.
${finalVerdict?.verdict === 'NG' ? `\n## FIX round — the final regression returned NG last round. Confirm these are resolved:\n${renderIssues(finalVerdict.issues)}\n` : ''}
Return OK only if the whole suite is green, the game boots, and the screen matches; otherwise NG with specific, reproducible issues.`

// --- The enforced loop ------------------------------------------------------

log(`game-build-team loop starting: ${features.length} feature(s), tier=${cfg.modelTier || 'max-fidelity'}, maxRounds=${maxRounds}`)

// --- Graceful drain ----------------------------------------------------------
// Once any agent reports wrappedUp (usage-watchdog sentinel) or dies on a
// terminal API error (agent() returns null after retries), the run DRAINS:
// nothing new launches, in-flight features return status 'deferred', and the
// result lists what to resume. State on disk stays accurate — done features
// were durably marked by the gates; wrapped agents left handoff reports.
let draining = false // false | 'usage-wrap-up' | 'api-failure'

async function call(prompt, opts) {
  if (draining) return null
  const r = await agent(prompt, opts)
  if (r === null) {
    draining = draining || 'api-failure'
    log(`DRAIN: agent ${opts?.label || '(unlabeled)'} returned null (terminal API error) — deferring all remaining work`)
  } else if (r.wrappedUp) {
    draining = draining || 'usage-wrap-up'
    log(`DRAIN: agent ${opts?.label || '(unlabeled)'} wrapped up on a usage sentinel${r.handoffPath ? ` (handoff: ${r.handoffPath})` : ''} — deferring all remaining work`)
  }
  return r
}

const deferred = (feature, rounds, extra) => ({ feature: feature.name, status: 'deferred', reason: draining || 'wrap-up', rounds: rounds || 0, ...extra })

// One build round: logic -> (animation) -> test gate -> (creative gate).
// Returns { testVerdict, creativeVerdict, build } or { halted: true, ... } on drain.
async function oneRound(feature, brief, round, prevTest, prevCreative, lastBuild) {
  const build = await call(logicPrompt(feature, brief, prevTest, prevCreative, lastBuild), { label: `logic:${feature.name}#${round}`, phase: 'Logic', schema: BUILD_SCHEMA, model: M.logic })
  if (!build || build.wrappedUp) return { halted: true, build }
  if (animationPass) {
    const anim = await call(animationPrompt(feature, brief, prevTest, prevCreative, build), { label: `animation:${feature.name}#${round}`, phase: 'Animation', schema: BUILD_SCHEMA, model: M.animation })
    if (!anim || anim.wrappedUp) return { halted: true, build }
  }
  const isFinalGate = !creativeGate
  const testVerdict = await call(testPrompt(feature, brief, build, isFinalGate), { label: `test:${feature.name}#${round}`, phase: 'Test Gate', schema: VERDICT_SCHEMA, model: M.tester })
  if (!testVerdict || testVerdict.wrappedUp) return { halted: true, build }
  if (testVerdict.verdict !== 'OK') return { testVerdict, creativeVerdict: null, build }
  if (!creativeGate) return { testVerdict, creativeVerdict: { verdict: 'OK', scope: 'creative gate disabled', issues: [] }, build }
  const creativeVerdict = await call(creativePrompt(feature, brief, build, testVerdict), { label: `creative:${feature.name}#${round}`, phase: 'Creative Gate', schema: VERDICT_SCHEMA, model: M.creative })
  if (!creativeVerdict || creativeVerdict.wrappedUp) return { halted: true, build, testVerdict }
  return { testVerdict, creativeVerdict, build }
}

async function buildAndVerify(feature) {
  if (feature.status === 'done') {
    log(`skip (already done): ${feature.name}`)
    return { feature: feature.name, status: 'done', rounds: 0, cached: true }
  }
  if (draining) { log(`deferred (draining): ${feature.name}`); return deferred(feature) }

  // Brief (skip if the Manager / a prior run already wrote one). No global phase()
  // here — features run concurrently and would race the global phase state.
  let brief = feature.briefPath ? { briefPath: feature.briefPath, featureName: feature.name } : null
  if (!brief) {
    brief = await call(briefPrompt(feature), { label: `brief:${feature.name}`, phase: 'Brief', schema: BRIEF_SCHEMA, model: M.creative })
    if (!brief || brief.wrappedUp) return deferred(feature, 0, { handoffPath: brief?.handoffPath })
  }

  let round = 0, testVerdict = null, creativeVerdict = null, lastBuild = null

  // RESUME — status 'tested': correctness was verified in a prior run but the fun
  // gate never passed. Run the creative gate ONLY; fix-loop if it's NG.
  if (feature.status === 'tested' && creativeGate) {
    creativeVerdict = await call(creativePrompt(feature, brief, { summary: 'pre-tested build from a prior run — judging fun' }, null), { label: `creative-revalidate:${feature.name}`, phase: 'Creative Gate', schema: VERDICT_SCHEMA, model: M.creative })
    if (!creativeVerdict || creativeVerdict.wrappedUp) return deferred(feature, 0, { handoffPath: creativeVerdict?.handoffPath })
    if (creativeVerdict.verdict === 'OK') {
      log(`OK ${feature.name} (re-validated fun on a pre-tested build — 0 build rounds)`)
      return { feature: feature.name, status: 'pass', rounds: 0, brief, build: null, testVerdict: { verdict: 'OK', scope: 'pre-tested' }, creativeVerdict, revalidated: true }
    }
    log(`NG ${feature.name} creative re-validation: ${(creativeVerdict.issues || []).length} issue(s) — entering fix loop`)
  }

  // RESUME — status 'built': files exist but were never gated. Lead with the TEST
  // gate (don't burn a round rebuilding possibly-good code), then the creative gate.
  if (feature.status === 'built') {
    testVerdict = await call(testPrompt(feature, brief, { summary: 'pre-existing build from a prior run — re-validating', filesWritten: feature.targetFiles || [] }, !creativeGate), { label: `test-revalidate:${feature.name}`, phase: 'Test Gate', schema: VERDICT_SCHEMA, model: M.tester })
    if (!testVerdict || testVerdict.wrappedUp) return deferred(feature, 0, { handoffPath: testVerdict?.handoffPath })
    if (testVerdict.verdict === 'OK') {
      if (!creativeGate) { log(`OK ${feature.name} (re-validated existing build — 0 build rounds)`); return { feature: feature.name, status: 'pass', rounds: 0, brief, build: null, testVerdict, revalidated: true } }
      creativeVerdict = await call(creativePrompt(feature, brief, { summary: 're-validated existing build' }, testVerdict), { label: `creative-revalidate:${feature.name}`, phase: 'Creative Gate', schema: VERDICT_SCHEMA, model: M.creative })
      if (!creativeVerdict || creativeVerdict.wrappedUp) return deferred(feature, 0, { handoffPath: creativeVerdict?.handoffPath })
      if (creativeVerdict.verdict === 'OK') { log(`OK ${feature.name} (re-validated existing build, both gates — 0 build rounds)`); return { feature: feature.name, status: 'pass', rounds: 0, brief, build: null, testVerdict, creativeVerdict, revalidated: true } }
    }
    log(`NG ${feature.name} re-validation — entering fix loop`)
  }

  // Main loop: build -> (juice) -> test gate -> creative gate, until BOTH OK or cap.
  while (round < maxRounds) {
    round++
    const r = await oneRound(feature, brief, round, testVerdict, creativeVerdict, lastBuild)
    if (r.halted) {
      log(`DEFERRED ${feature.name} (round ${round}): run draining (${draining || 'wrap-up'})`)
      return deferred(feature, round, { brief, build: r.build || lastBuild, handoffPath: r.build?.handoffPath })
    }
    lastBuild = r.build; testVerdict = r.testVerdict; creativeVerdict = r.creativeVerdict
    if (testVerdict.verdict === 'OK' && creativeVerdict && creativeVerdict.verdict === 'OK') {
      log(`OK ${feature.name} (round ${round}) — both gates passed`)
      return { feature: feature.name, status: 'pass', rounds: round, brief, build: lastBuild, testVerdict, creativeVerdict }
    }
    const which = testVerdict.verdict !== 'OK' ? `test NG (${(testVerdict.issues || []).length})${testVerdict.suiteGreen === false ? ' [suite RED]' : ''}` : `creative NG (${(creativeVerdict?.issues || []).length})`
    log(`NG ${feature.name} round ${round}: ${which}`)
  }
  log(`FLAGGED ${feature.name}: hit round cap (${maxRounds}) — needs Manager attention`)
  return { feature: feature.name, status: 'flagged', rounds: round, brief, build: lastBuild, lastTestVerdict: testVerdict, lastCreativeVerdict: creativeVerdict }
}

// Features build in WAVES of `waveSize` (each runs its own enforced loop). Waves
// run sequentially; within a wave, features are parallel. waveSize is sized to the
// host by the Manager (scripts/capacity.mjs) so a tight box doesn't OOM. Each
// passing feature is durably marked done between waves, so a crash resumes.
async function buildInWaves(items) {
  const out = []
  const total = Math.ceil(items.length / waveSize)
  for (let w = 0; w * waveSize < items.length; w++) {
    if (draining) {
      const rest = items.slice(w * waveSize)
      log(`draining (${draining}) — deferring the remaining ${rest.length} feature(s) without launching: ${rest.map(s => s.name).join(', ')}`)
      out.push(...rest.map(f => deferred(f)))
      break
    }
    const chunk = items.slice(w * waveSize, w * waveSize + waveSize)
    if (waveSize < items.length) log(`wave ${w + 1}/${total}: ${chunk.map(s => s.name).join(', ')}`)
    const res = await pipeline(chunk, (feature) => buildAndVerify(feature))
    out.push(...res)
  }
  return out
}

const runDocs = () => docsDepth === 'none'
  ? Promise.resolve(null)
  : call(docsPrompt(), { label: 'domain-architect', phase: 'Docs', schema: DOC_SCHEMA, model: M.docs })

const [featureResults, docsResult] = await Promise.all([buildInWaves(features), runDocs()])

const passed = featureResults.filter(r => r && (r.status === 'pass' || r.status === 'done'))
const flagged = featureResults.filter(r => r && r.status === 'flagged')
const deferredResults = featureResults.filter(r => r && r.status === 'deferred')
log(`features complete: ${passed.length} passed, ${flagged.length} flagged, ${deferredResults.length} deferred`)

// Final full-suite regression — only when at least one feature passed AND nothing
// is still flagged or deferred. Verifying with zero passed features is never a valid "done".
let finalVerdict = null, finalRound = 0
if (draining) {
  log(`Final regression skipped — run is draining (${draining}). Resume after the window resets.`)
} else if (skipFinal) {
  log(`Final regression skipped (skipFinal): ${passed.length} passed, ${flagged.length} flagged. Manager runs it in Phase 3.`)
} else if (passed.length > 0 && flagged.length === 0 && deferredResults.length === 0) {
  while (finalRound < finalCap) {
    finalRound++
    finalVerdict = await call(finalPrompt(featureResults, finalVerdict, finalRound), { label: `final-regression#${finalRound}`, phase: 'Final Regression', schema: VERDICT_SCHEMA, model: M.tester })
    if (!finalVerdict || finalVerdict.wrappedUp) { finalVerdict = null; log(`Final regression deferred — run draining (${draining})`); break }
    if (finalVerdict.verdict === 'OK') { log('FINAL REGRESSION: OK'); break }
    log(`FINAL REGRESSION round ${finalRound}: NG (${(finalVerdict.issues || []).length} issue(s))`)
    if (finalRound < finalCap) {
      await call(`${LOGIC_PERSONA}\n\n${CONTEXT}\n\n## Task: FIX the cross-feature regression failures below, then make the full suite green again. Delete dead paths; do not duplicate.\n${renderIssues(finalVerdict.issues)}`,
        { label: `final-fix#${finalRound}`, phase: 'Final Regression', schema: BUILD_SCHEMA, model: M.logic })
    }
  }
} else if (deferredResults.length > 0) {
  log(`Skipping final regression — ${deferredResults.length} deferred feature(s) still need a resumed run: ${deferredResults.map(f => f.feature).join(', ')}.`)
} else if (passed.length === 0) {
  log('Skipping final regression — ZERO features passed the gates. Nothing shippable (check build logs).')
} else {
  log(`Skipping final regression — ${flagged.length} flagged feature(s) need the Manager first: ${flagged.map(f => f.feature).join(', ')}.`)
}

return {
  summary: {
    features: featureResults.length,
    passed: passed.length,
    flagged: flagged.map(f => f.feature),
    deferred: deferredResults.map(f => f.feature),
    drained: draining || false,
    finalVerdict: finalVerdict?.verdict || 'not-run',
    docsCoverage: docsResult?.coverage || (docsDepth === 'none' ? 'skipped' : 'unknown'),
    driftFlags: docsResult?.driftFlags || [],
  },
  featureResults,
  docsResult,
  finalVerdict,
}
