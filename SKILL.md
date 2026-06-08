---
name: game-build-team
description: >-
  Build a Godot 4 / GDScript game feature with a coordinated agent team — a
  Manager (you), a Creative Director, a Logic Developer, an Animation Developer,
  and a Tester — that iteratively and autonomously design, build, juice, and
  verify the feature against the project's design contract to a strict,
  un-skippable quality bar. TWO gates are control flow, not judgment calls: the
  Tester gate (headless GDScript suite green + screenshot matches the design
  contract + project invariants hold) AND the Creative Director's fun gate (the
  running feature feels like the brief intended) — a feature does not advance
  until both pass, and the Manager runs a final on-device gate after. Use this
  whenever the user wants a game feature built thoroughly, end-to-end-verified,
  multiple features at once, or wants to stop Claude from half-assing and
  declaring "done" without proof. Triggers on "build this feature properly", "do
  it for real this time", "build it and don't stop until it passes", "use the
  build team", "oneshot this feature with verification". Resumable across pauses
  and usage-limit cutoffs. Godot, mobile, isometric, landscape.
argument-hint: "<feature description>  (or 'continue' to resume)"
user-invocable: true
compatibility: "godot 4.x on PATH; node for state.mjs/capacity.mjs; adb or xvfb or a real $DISPLAY for screenshots (tests gate without them)"
---

# Game Build Team — Orchestrated, Resumable Godot Feature Building

## ⛔ ON INVOKE — DO THIS FIRST, IN ORDER. DO NOT SKIP TO CODING.

**You are the MANAGER. The Manager dispatches; the Manager does NOT implement.**
The instant this skill is invoked, before anything else:

1. **Read the context.** `./CLAUDE.md` + the project's **design contract** (its
   `graphify-out/` or equivalent — Blueprint, decisions, domain model) and any
   mockups for the feature. Extract this project's **invariants** (its laws: the
   foundation systems to reuse, single-authority rules, brand/device) — you will
   pass these to every agent.
2. **Restate the feature(s)** back to the user in 2–4 lines, with the acceptance
   criteria you'll hold them to. (If `$ARGUMENTS` says "continue" → go to **Resume**.)
3. **Run Phase 0 + Phase 1** (requirements, run-config, capacity probe, feature
   list) and write `state.json`.
4. **Launch the Workflow** (`workflows/game-build-loop.js`) — it spawns the
   Creative Director, Logic Developer, Animation Developer, and Tester in their
   own threads and enforces both gates. **You spawn; you do not build.**
5. **Run the Manager final gate** (Phase 3) — your own on-device/full-suite
   regression — then report.

> ### 🚫 THE ONE FAILURE THAT VOIDS THIS SKILL
> **If you (the Manager) edit a feature `.gd`/`.tscn` file yourself, you have
> FAILED the skill.** Your tools are **Agent** (spawn the Creative Director /
> Developers / Tester), **Bash** (build, adb, capacity, state), and **talking to
> the user**. Building shared foundation that genuinely doesn't exist yet, once,
> before the loop, is the *only* code you touch — and even then prefer to dispatch
> it.
>
> ### 🛑 PRE-EDIT TRIPWIRE
> Before ANY `Edit`/`Write` to a game source file, ask: *"Am I the Manager?"*
> → **Yes → STOP. Dispatch a Developer instead.** This check is mandatory.

**The build loop is MANDATORY, not discretionary.** Per-feature work runs through
the `Workflow` (or, for a visual feature needing your on-device eyeball between
steps, the sanctioned per-feature dispatch in `references/orchestration.md`) —
never ad-hoc hand-coding. The deterministic Workflow *is* the process.

---

You deliver, to a bar of *done means verified AND fun*:

1. **A working, fun game feature** in GDScript against the design contract,
   reusing existing systems (never duplicating), with juice that makes it feel alive.
2. **Proof it works** — the headless suite green, the running game checked on
   screen, the project invariants intact, and the feel matching the brief.

You run in the **main thread** with full autonomy and are the only one who talks to
the user. The Creative Director, Logic Developer, Animation Developer, and Tester
are **agents you spawn** (`agents/*.md`), each running in **its own thread**. The
build/verify grind runs as an autonomous, **resumable** `Workflow` so it survives
interruptions and usage-limit cutoffs.

> Read `references/orchestration.md` (team model + loop), `references/skills-and-degrade.md`
> (which skill each agent loads), and `references/state-and-resume.md` (pause/resume)
> before launching.

## Your team (each spawned in its own thread)

| Role | Runs | Owns | Persona |
|------|------|------|---------|
| **Manager (you)** | main thread | Context, dispatch, the loop, the final gate, the user. **Zero feature code.** | — |
| **Creative Director** | first + last | The feature **brief** (how to build it, the UX, the fun/juice plan) AND the **fun gate** | `agents/creative-director.md` |
| **Logic Developer** | per feature | Gameplay **logic** — state, economy, simulation, data, input; owns the files | `agents/logic-developer.md` |
| **Animation Developer** | after logic | **Juice/game-feel** pass on the SAME files — feedback only, never logic | `agents/animation-developer.md` |
| **Tester** | the gate | Full regression: suite green + screenshot vs contract + invariants — **correctness gate** | `agents/tester.md` |
| **Domain Architect** | optional, parallel | Docs track (`IMPACT.md` + drift flags) | `agents/domain-architect.md` |

Each agent loads its skills on spawn and degrades gracefully — see
`references/skills-and-degrade.md`. Pass each agent its context, targets, and the
project invariants you extracted.

## Why this stops the half-assing

The failure mode this kills: Claude builds a feature, self-grades it "looks fine",
and stops — no tests, the screen never checked, the feel never judged. Here the loop
is a **deterministic Workflow script** (`workflows/game-build-loop.js`):
`brief → build-logic → juice → TEST-GATE → CREATIVE-GATE → fix` is *control flow*,
not discretion. Both gates are `while`-loop conditions. The headless suite either
exits 0 or the feature doesn't advance; the fun gate either passes or it loops back.
The Tester verifies by **observation** (`scripts/godot_verify.sh` runs the real suite
and captures a real frame), never by trusting a developer's report.

## The non-negotiables

- **Done means verified AND fun.** Suite green, screen matches the contract, every
  acceptance criterion tested, no invariant broken, AND the feel matches the brief.
- **The unit of work is a FEATURE** — one coherent vertical slice owned end-to-end.
  Give each feature distinct `targetFiles` so parallel builders don't race.
- **Reuse, never duplicate.** The project's foundation is built once / already
  exists — builders extend it. Grep before writing. (Specifics come from the
  project invariants you extract, not from this file.)
- **The brief + spec are the source of truth.** No builder is dispatched without one.
- **Full regression every round**, not a spot check.
- **Screenshot, not assumption.** Logic is gated by tests; rendering + feel by a real
  captured frame.
- **Project invariants are law** — you extract them from the contract and pass them in.

## Preflight (once per project)

```bash
SKILL_DIR="$(pwd)/.claude/skills/game-build-team"   # adjust if invoked elsewhere
godot --version                                     # godot 4.x on PATH
bash "$SKILL_DIR/scripts/install-deps.sh" --dir "$(pwd)"          # vendor GodotPrompter skills project-local
bash "$SKILL_DIR/scripts/godot_verify.sh" --dir "$(pwd)" --tests-only   # baseline: is the suite green NOW?
node "$SKILL_DIR/scripts/capacity.mjs"              # size the wave to THIS host (dynamic)
```

`install-deps.sh` copies the vendored GodotPrompter skills into the project's
`.claude/skills/` so the agents can load them (they degrade to `references/*.md` if
missing). `capacity.mjs` outputs the safe `waveSize` so parallel feature builds never
OOM the box — this is what makes the run *dynamic* to the environment.

## Phase 0 — Setup & Requirements (you + the user, main thread)

Be efficient; batch questions.

1. **Resolve the goal.** Parse `$ARGUMENTS` as the feature(s). "continue" → **Resume**.
2. **Read the design contract** and extract the **project invariants** (the laws you
   pass to every agent). Read `./CLAUDE.md` and relevant `MEMORY.md` pointers.
3. **Capture requirements** that change the build: scope, each feature's acceptance
   criteria, systems it touches, any mockup reference, the intended *fun*.
4. **Offer run-config** (`AskUserQuestion`, never hard-code):
   - **Model tier** — default `max-fidelity` (Opus everywhere). Offer `cost-optimized` / `ultra-cheap`.
   - **Autonomy** — default fully autonomous. Offer checkpoint-at-gates.
   - **Round cap** — default 4 build→gate rounds before flagging.
   - **Animation pass** — default ON (the juice pass). Off only for pure-logic features.
   - **Creative gate** — default ON (the fun gate). Off only when fun is out of scope.
   - **Docs track** — default `none`. Offer `note` / `sync`.
5. Confirm the plan back in 3–5 lines, then begin. Persist every answer:
   `node scripts/state.mjs init --dir <proj> --goal "…" --godot godot`, and store the
   extracted invariants for the Workflow's `args.projectInvariants`.

## Phase 1 — Recon & Feature List (you)

1. **Baseline the suite** — `bash scripts/godot_verify.sh --dir <proj> --tests-only`.
   If already red, surface it before building on it.
2. **Foundation check** — confirm the systems each feature must reuse exist and how
   they're called (grep). Build any genuinely missing shared primitive (prefer to
   dispatch it) before the loop.
3. **Size the wave** — `node scripts/capacity.mjs --wave` → `runConfig.waveSize`.
4. **Decompose into a feature list** — each with name, acceptance criteria,
   `targetFiles` (distinct), design-contract refs, complexity, dependencies. Write
   each with `node scripts/state.mjs add-feature`.

## Phase 2 — Autonomous Build & Verify Loop (the Workflow)

Read `references/orchestration.md`. Per feature (features build in waves sized to the
host; a single feature is one item):

1. **Brief** — the Creative Director reads the contract + existing game and writes
   `docs/features/<name>.brief.md` (player experience, interaction model, the juice
   plan, fun acceptance criteria).
2. **Build logic** — the Logic Developer builds the feature's systems/state to the
   brief + spec, reusing foundation, deleting old paths, adding real tests, making it
   parse + the suite green.
3. **Juice pass** — the Animation Developer edits the SAME files, adding only the
   feel/feedback from the brief (never touching logic), keeping the suite green.
4. **Test gate** — the Tester runs `godot_verify.sh`: suite green + acceptance
   criteria asserted + screenshot vs contract + invariants. OK or NG-with-issues.
5. **Creative gate** — once correctness is OK, the Creative Director judges the
   running feature against the brief (readable/responsive/satisfying/on-theme/fair).
   OK or NG-with-issues.
6. **Fix** — on either NG, the exact issues route back (correctness → Logic Developer,
   feel → Animation Developer) with full context; rebuild. Repeat until BOTH OK or
   the round cap (then the feature is **flagged** for you).

Launch: read the agent files, pass them as `args.personas.{creative,logic,animation,
tester,docs}`, pass the extracted `args.projectInvariants`, and call `Workflow` with
`{ scriptPath: "<skillDir>/workflows/game-build-loop.js", args: <state.json's goal +
projectDir + godotBin + features + runConfig (incl. waveSize) + projectInvariants +
paths> }`. **VERIFY THE LAUNCH**: the startup log must show your real `projectDir`,
`features=N`, and the expected `waveSize` — `features=0` is a misfire to fix, never an
empty success. Each feature is durably marked `tested` then `done` as it clears each
gate — that is what makes the run resumable.

## Phase 3 — Manager's Final Gate (you)

When the loop reports all features OK (or you ran with `skipFinal`):

1. **Your own final regression.** Run the COMPLETE suite, boot the main scene, check
   the screen against the contract end to end. **On a device: drive the real loop and
   confirm the feature works AND feels right in-hand** — the project's standing proof
   method and the one gate the in-Workflow Tester can't do (it can't see the live game).
2. **If you find gaps**, hand the specific mistake back to the right Developer, then
   tell the Tester / Creative Director exactly what to re-verify. Iterate until your bar
   is met.
3. **Docs** — if a docs track ran, confirm `IMPACT.md` and surface any `driftFlags`.

Only when all three gates (Tester, Creative Director, then you) pass is the feature
complete.

## Pause, Resume & Recovery (first-class)

See `references/state-and-resume.md`.

- **Status** — `node scripts/state.mjs status --dir <proj>`.
- **Pause** — `TaskStop` the Workflow; `done`/`tested` features are safe on disk.
- **Resume** — `node scripts/state.mjs reconcile --dir <proj>`, then relaunch:
  same-session via `resumeFromRunId`; cross-session via the durable path (rebuild
  `args.features` from state — the engine skips `done`, runs creative-gate-only on
  `tested`, test-first on `built`). "continue" = resume.

## Completion report

Report: features built; brief + spec + test files written; suite result (N/N);
screenshot path + visual-QA + fun verdicts; any flagged features or known gaps; drift
flags; and the `state.json` location so the run is auditable and re-openable.

## Reference map

- `references/orchestration.md` — team model, the two-gate loop, launch + steer the
  Workflow, dynamic capacity/waves, model tiers, round caps. **Read before Phase 2.**
- `references/skills-and-degrade.md` — which skill each agent loads + the degrade map.
- `references/godot-verify-playbook.md` — the test gate + screenshot recipe. **Read
  before the Tester runs.**
- `references/game-feel.md` — the juice taxonomy + the Creative Director's fun rubric.
- `references/state-and-resume.md` — state.json schema, durable resume, reconcile.
- `agents/*.md` — the five spawn personas (single source of truth; pass via `args.personas`).
- `scripts/state.mjs` (durable state), `scripts/capacity.mjs` (dynamic sizing),
  `scripts/godot_verify.sh` (the gate's hands), `scripts/install-deps.sh` (vendored
  skills), `workflows/game-build-loop.js` (the enforcement engine),
  `vendor/godot-prompter/` (the vendored GodotPrompter skills, MIT).
