# Orchestration — the team, the two-gate loop, and the Workflow

Operating manual for the Manager (the main-thread Claude running the
`game-build-team` skill). Read before Phase 3 (the build loop).

## The phase machine (every session, no arbitrary order)

```
0 ask user → 1 RECON ▶wf → (blockers? tell user, stop) → 2 plan → 3 BUILD ▶wf → 4 final gate → 5 finish + suggest next
```

The **fan-out phases (1 recon, 3 build/verify) are Workflows** — governed, resumable,
no scatter. Phases **0, 2, 4, 5 are main-thread** because they need the **user** (an
interactive question/sign-off) or a **holistic real-hand pass** on the live device —
but they are **fixed scripted steps**, never improvisation. The one genuine Workflow
limit is that it **cannot ask the user a question mid-run** (it runs in the background).
It CAN drive `adb` — agents have `Bash`, so the build loop deploys to the device itself
(`godot_verify.sh --deploy`); the device just gets serialized on a lock so parallel
features don't collide. Phase 4 stays in your thread for the *cross-feature* judgment,
not because the Workflow is blind to the device.

## Why a Workflow, and not "just spawn agents and iterate"

The whole point is that **gates protect quality** and **nothing ships past them**.
If the loop lived only in the Manager's head, the Manager could (under token
pressure or optimism) quietly skip the Tester, accept a "looks fine" feature, skip
the juice, or forget to re-run the suite after a fix. **That is the half-assing this
skill exists to prevent.**

So the loop is a **deterministic `Workflow` script** (`workflows/game-build-loop.js`).
The script *is* the process. It runs `brief → build-logic → juice → test-gate →
creative-gate → fix` as control flow, so the steps cannot be reordered or skipped by
anyone — not the Manager, not a developer agent, not the model on an off day. Both
gates are `while`-loop conditions. The headless suite either exits 0 or the feature
does not advance.

**Deterministic order, dynamic scale.** The *step order* is fixed; *how many features
build in parallel* is `runConfig.waveSize`, which the Manager sizes to the host via
`scripts/capacity.mjs`. Same skill, big box → wide waves, tight box → narrow waves,
nothing OOM-killed.

The Manager still owns everything the Workflow can't: talking to the user (Phase 0),
gathering requirements + the project invariants, synthesizing the recon report into the
plan (Phase 2), launching/steering both Workflows, the human on-device final gate
(Phase 4), the finish + next-steps suggestion (Phase 5), and the resume decisions.
Recon itself is now its own Workflow (`workflows/recon.js`, Phase 1) — the Manager
launches it and acts on its report (blockers → tell the user to install, then stop).

> A Workflow runs in the **background** and **cannot talk to the user mid-run**.
> Anything interactive (requirements, checkpoint sign-off) happens in the Manager's
> phases; the autonomous grind happens in the Workflow.

## The actor model

```
        user  ⇄  MANAGER (you, main thread, holds the goal + invariants)
                 │  Phase 0 ask user + extract project invariants
                 │  Phase 1 launch RECON ▶wf;  Phase 2 plan from its report
                 │  Phase 4 on-device final gate;  Phase 5 finish + suggest next
                 └──────────────┬──────────────┘
                                │ launches + steers
                      ┌─────────▼─────────┐
                      │  WORKFLOW (script) │  enforces the loop
                      └───┬───────────┬────┘
        per feature, in waves │       │ in parallel (docsDepth != none)
        ┌─────────────────────▼─────┐ ┌─▼───────────────────┐
        │ BRIEF (Creative Director)  │ │ DOMAIN ARCHITECT    │
        │ LOGIC DEV builds systems   │ │ writes IMPACT.md    │
        │ ANIMATION DEV juices it    │ └─────────────────────┘
        │ TEST GATE (Tester)         │
        │   ↑ NG ── fix ──┐          │
        │ CREATIVE GATE (Creative D.)│
        │   ↑ NG ── fix ──┘          │
        │   └── both OK ──► done     │
        └────────────────────────────┘
              then: final full-suite regression → fix (enforced)
```

- **Manager** = main thread. Full autonomy, only one who talks to the user, writes
  ZERO feature code.
- **Creative Director, Logic Developer, Animation Developer, Tester, Domain Architect**
  = agents the Workflow spawns via `agent()`, each in its own thread. Canonical
  personas in `agents/*.md`; the Workflow embeds tight capsules, overridable via
  `args.personas` so the Manager passes the full files as the single source of truth.
- The Tester drives the real artifact via `scripts/godot_verify.sh` — headless suite +
  screenshot. No web browser is involved.

## The two gates (both are control flow)

1. **Test gate (Tester)** — correctness. Headless GDScript suite exits 0, acceptance
   criteria asserted, screenshot matches the design contract, invariants intact. NG →
   issues route to the Logic Developer.
2. **Creative gate (Creative Director)** — fun. Only runs once correctness is OK.
   Judges the running feature against its brief (readable/responsive/satisfying/
   on-theme/fair). NG → feel issues route to the Animation Developer, logic-rooted
   issues to the Logic Developer.

A feature is durably marked `tested` when the test gate passes, then `done` when the
creative gate also passes (resume keys off these). With `creativeGate: false` the test
gate is the final gate and marks `done` directly.

Then the **Manager's on-device final gate** (Phase 4) — a holistic, real-hardware pass
over the whole delivery. The in-Workflow Tester runs **rapid** rounds by default: the
fresh source-render simulation (the same `drive_<slug>.gd` harness the developer
used — seconds per round, so NG→fix iteration stays fast). It still CAN
build+deploy the fresh APK (`godot_verify.sh --deploy`) and screencap the device —
reserved for inherently device-specific features (touch input, safe-area/DPI,
on-device perf), recording which fidelity it got. So Phase 4 is **the** thorough
on-device pass of the run — fresh deploy, real hardware, features interacting, the
whole thing feeling right in-hand — once, instead of minutes spent per round.

## How the Manager launches the build Workflow

1. Finish Phases 0–2 so `.game-build-team/state.json` has: goal, projectDir,
   godotBin, the **feature list** (planned from the recon report, with reuse targets),
   run-config (incl. `waveSize` from recon's `capacity`), the **project invariants**,
   and the paths block (incl. `statePath` AND `reportPath`).
2. Read the `agents/*.md` files; pass their bodies as `args.personas.{creative,logic,
   animation,tester,docs}`. Pass `args.projectInvariants` = the laws you extracted.
3. **Start the usage watchdog** (background Bash, zero tokens):
   `node "<skillDir>/scripts/usage-watchdog.mjs" start --dir <proj>` with
   `run_in_background: true`. It polls the account's 5-hour usage window every
   5 minutes and writes `WRAP_UP` (warm stop, ≥80%) / `HARD_STOP` (≥93%) sentinels
   that the agents' wrap-up protocol checks — the run drains gracefully with
   handoff reports instead of dying mid-agent at a cutoff. Details in
   `references/state-and-resume.md`.
4. Call `Workflow` with `{ scriptPath: "<skillDir>/workflows/game-build-loop.js",
   args: <the object above> }`. Pass `args` as a real JSON object (the engine also
   accepts a JSON string and aborts loudly on a bad/empty payload).
5. **VERIFY THE LAUNCH (mandatory).** Confirm the startup `log()` shows your real
   `projectDir`, `godot=<bin>`, `features=N`, and the expected `waveSize` — not the
   defaults. `features=0` is a misfire to fix, never an empty "success".
6. Record the `runId` (`node scripts/state.mjs set-run --run-id <id>`). Watch with
   `/workflows`. On the notification, read the structured return and go to Phase 4.
   If the return shows `summary.drained` / `summary.deferred`, the run wound down
   early (usage cutoff or API failure): report it to the user, then resume later
   via `reconcile` + relaunch — deferred features pick up from their handoffs.

## Model-tier wiring

| Tier | Creative | Logic | Animation | Tester | Docs |
|------|----------|-------|-----------|--------|------|
| `max-fidelity` (default) | opus | opus | opus | opus | opus |
| `cost-optimized` | sonnet | sonnet | sonnet | sonnet | sonnet |
| `ultra-cheap` | sonnet | sonnet | haiku | haiku | haiku |

Manager runs in the session model. Let the user choose at Phase 0. Never hard-code.

## Round caps (runaway-spend guard)

- `maxRounds` (default 4): per-feature build→both-gates rounds before the feature is
  **flagged** for the Manager instead of looping forever.
- `finalCap` (default 3): final-regression → fix rounds.
- A flagged feature blocks the final regression; the Manager decides whether to
  re-dispatch with a tighter brief/spec, split it, or ask the user.

## Dynamic capacity & waves (crash-resilience)

- `node scripts/capacity.mjs --wave` probes RAM/cores/oomd and returns a safe
  `waveSize`: how many features build concurrently. Each feature's Tester spawns a
  `godot` process (+ xvfb for the screenshot); too many at once on a tight box OOMs.
- Waves run sequentially; features within a wave run in parallel. Each completed
  wave's features are durably marked, so a crash resumes instead of restarting.
- Small box → small wave (1–2). Big box → larger. The probe decides, not a guess.

## skipFinal / checkpoint mode

- `skipFinal: true` — build + gate features only; the Manager runs the final
  full-suite regression in Phase 4.
- **Checkpoint-at-gates** (non-autonomous): launch the Workflow for one feature (or a
  small batch), report the gate verdicts to the user, get sign-off, continue.

## Workflow MANDATORY — no exceptions, no side-dispatch

The Workflow is the **only** path that builds or verifies a feature. There is **no**
per-feature side-dispatch and **no** spawning a build/verify agent from the main thread —
that discretion is exactly what this skill removes. Build, juice, test, *and* any
in-loop `--deploy` (device-specific features) all happen inside the pipeline (the
Tester drives the device there). If you want on-device confidence between steps, that
is the Tester's `--deploy` at the gate (device-specific features only — the gate is
rapid by default), or your **own** `Bash`/`adb` check in the main thread (a tool, not
an agent) — never an `Agent(...)` you spin up yourself. The Manager writes ZERO feature code and spawns ZERO build/verify
agents; ad-hoc hand-coding and main-thread verify-agents are both unsanctioned.

## The unit of work is a FEATURE

One coherent vertical slice owned end-to-end: its GDScript/`.tscn` files, its tests,
its acceptance criteria, its brief. Give every feature distinct `targetFiles` so
parallel builders don't race. Shared foundation is built once before the loop (prefer
to dispatch it) or already exists — builders reuse it, never duplicate it. If two
features must touch the same file, merge them or run with `isolation: 'worktree'` and
merge after; prefer distinct files.
