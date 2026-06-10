# Skills each agent loads (capability-first, with intentional overlap)

The single source of truth for **which Claude skills each agent loads before doing
any work**. Every companion skill listed here is **installed from source into the
project on init** (`scripts/install-deps.sh`, project-local) — so every agent always
has the real, full-depth skill. **There is no fallback.** A missing companion skill is
a preflight/recon **blocker** that stops the run; it is never silently swapped for a
thinner reference doc. (The `references/*.md` here are *craft references* the agents may
cite — not stand-ins for a skill that failed to install.)

The key idea: **capabilities overlap on purpose.** A developer who can't see the
running UI or debug a red suite isn't a developer; a Manager who can't test and
verify can't run a final gate. So skills are assigned by **capability**, and the
shared capabilities are loaded by *every* agent that needs them — not siloed into one
role. This file is what `install-deps.sh` provisions and what the Manager points
agents at.

## Where the skills come from

| Source | What | How we use it |
|--------|------|---------------|
| **vendored GodotPrompter** (`vendor/godot-prompter/`) | 48 Godot 4.x domain skills (MIT) | `install-deps.sh` installs ALL of them PROJECT-LOCAL into `<proj>/.claude/skills/` on init. Primary Godot knowledge. **Required, no fallback.** |
| **vendored Karpathy guidelines** (`vendor/karpathy/`) | `karpathy-guidelines` — LLM coding-pitfall discipline (MIT, from forrestchang/andrej-karpathy-skills) | Installed by the same `install-deps.sh` pass, same no-fallback rule. Part of the **code-quality bundle**; applied AS ADAPTED by the harmony mends below. |
| **already-installed, engine-agnostic** | `clean-code`, `clean-architecture`, `brainstorming`, `emil-design-eng` | Taste + discipline layers; loaded directly. |
| **wshobson/agents** `godot-gdscript-patterns` | high-credibility GDScript patterns | Optional cross-check for the Logic Developer (load if globally installed). |
| **this skill's `references/`** | `game-feel.md`, `godot-verify-playbook.md` | Craft references the agents cite (the juice taxonomy; the verify/screenshot recipe). NOT a fallback for a missing skill. |

Web/CSS skills from clone-team (`ui-pack`, `agent-browser`, `ui-animation`,
Remotion) are **not used** — wrong engine. Godot animates via `Tween` /
`AnimationPlayer` / `GPUParticles` / shaders, verified by screenshot, not a browser.

## Capabilities → skills (the vocabulary)

| Capability | Skill(s) |
|------------|----------|
| **See UI** — observe the *running* game and judge it | `godot-ui`, `responsive-ui` + `references/godot-verify-playbook.md` (the screenshot/adb recipe) |
| **Debug** — triage a red suite / wrong behavior | `godot-debugging` |
| **Test** — write/run the headless suite | `godot-testing` |
| **Verify / review** — code quality + anti-patterns | `godot-code-review`, `clean-code`, `karpathy-guidelines` (LLM-pitfall discipline) |
| **Code** — gameplay logic & systems | `gdscript-patterns`, `gdscript-advanced`, `state-machine`, `event-bus`, `component-system`, `dependency-injection`, `resource-pattern`, `save-load` + `clean-code`, `clean-architecture` |
| **Design / UX** — fun, feel, interaction | `emil-design-eng`, `2d-essentials`, `godot-ui`, `godot-brainstorming`, `brainstorming` |
| **Orchestrate** — mobile target, pipeline, requirements | `mobile-development`, `export-pipeline`, `responsive-ui` |

## The shared baseline (the overlap, made explicit)

Two bundles are loaded by *multiple* agents — this is the intentional overlap:

- **See-UI bundle** (`godot-ui`, `responsive-ui`, `references/godot-verify-playbook.md`)
  — loaded by **every** agent that touches or inspects the running game:
  Creative Director, Logic Developer, Animation Developer, Tester, Manager. Nobody
  on this team is allowed to be blind to what the game actually renders.
- **Code-quality bundle** (`godot-debugging`, `godot-testing`, `godot-code-review`,
  `karpathy-guidelines`) — loaded by every agent that writes, breaks, or judges code:
  Logic Developer, Animation Developer, Tester, Manager. The Logic Dev writes the
  tests the Tester runs and debugs its own red suite; the Manager re-tests and
  re-verifies at the final gate; the Tester owns all three. Same skills, same team.
  `karpathy-guidelines` is the bundle's LLM-discipline layer — it targets the
  classic agent coding failures (silent assumptions, overcomplication, touching
  code outside the task) and is applied **as adapted by the harmony mends below**.

## Karpathy guidelines — the harmony mends (how the four rules apply HERE)

The vendored `karpathy-guidelines` skill was written for an interactive session
with a user on the other end. Two of its four rules need adapting to this team's
shape; the other two are native here. Every agent that loads the skill applies it
**with these mends** — the mends never weaken a rule, they redirect it:

1. **Think Before Coding** — *"If uncertain, ask"* cannot mean asking the user:
   workflow agents have no channel to the user mid-run. The mend: resolve
   uncertainty from the **spec + brief + design contract + existing code** first;
   whatever genuinely remains becomes an explicit **`ASSUMPTIONS:` block in your
   report** (brief/build/verdict) so the gates and the Manager judge it — never a
   silent guess buried in code. Asking the user stays where it already lives: the
   Manager at Phases 0/2.
2. **Simplicity First** — applies to the **implementation**, never to the
   **briefed scope**. Juice/polish in the Creative Director's brief is *requested*
   scope, not "speculative features" — building it IS the minimum that solves the
   problem; skipping it fails the fun gate. What the rule kills here: abstractions
   for single-use code, unrequested configurability, error handling for impossible
   scenarios, 200 lines where 50 do it.
3. **Surgical Changes** — native. This IS the project invariants ("clean up,
   don't stack"; "single authority per concern") plus the Animation Developer's
   scope discipline (same files, feel only). One precision: *"don't remove
   pre-existing dead code"* yields to an explicit invariant — when the Manager's
   invariants order dead-path deletion for code **your change** supersedes, the
   invariant wins; unrelated dead code you merely noticed is still report-don't-touch.
4. **Goal-Driven Execution** — native. The two-gate loop IS this rule as control
   flow: acceptance criteria are the success criteria, the headless suite is the
   verifier, the gates loop until green. Devs phrase their work accordingly —
   write the failing test on the REAL call path first, then make it pass.

## Capability matrix (✓ = the agent loads it)

| Capability | Creative Dir | Logic Dev | Anim Dev | Tester | Manager |
|------------|:---:|:---:|:---:|:---:|:---:|
| **See UI** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Debug** | – | ✓ | ✓ | ✓ | ✓ |
| **Test** | – | ✓ | ✓ (keep green) | ✓ | ✓ |
| **Verify/review** | ✓ (fun) | ✓ (self) | ✓ (self) | ✓ | ✓ |
| **Code** | – | ✓ | ✓ (feel) | – | – |
| **Design/UX** | ✓ | read-only | ✓ | – | – |
| **Orchestrate** | – | – | – | – | ✓ |

## Per-agent load list (baseline + specialty)

Every companion skill below is installed locally by preflight before the agent runs,
so each agent loads them directly — there is nothing to fall back to.

### Recon Analyst (Phase 1 — the status-quo audit, before planning)
- **Loads:** `godot-project-setup` (what a healthy Godot 4 project/runtime needs, so it
  knows what "ready" looks like).
- **Reads, no skill needed:** the durable resume doc (`.game-build-team/state.json` +
  `report.json`) for progress; greps the project for reuse targets.
- **Why:** read-only reconnaissance — tool-gap blockers, done-vs-left, reuse grounding.
  It writes zero code; its Bash is probing only (`--version`, `which`, `--check`, `status`).

### Creative Director (runs first as the brief; last as the fun gate)
- **See-UI baseline:** `godot-ui`, `references/godot-verify-playbook.md` — so it can
  read the running-feature screenshot itself at the fun gate, not depend blindly on
  the Tester's word.
- **Specialty (design):** `godot-brainstorming`, `brainstorming`, `emil-design-eng`,
  `2d-essentials`.
- **Craft reference:** `references/game-feel.md` (the juice taxonomy).

### Logic Developer (gameplay systems / state / economy / simulation)
- **See-UI baseline:** `godot-ui`, `responsive-ui`, `references/godot-verify-playbook.md`
  — after the suite is green, capture a frame and confirm the feature actually
  *renders*; green tests are not "I saw it work."
- **Code-quality baseline:** `godot-debugging` (triage your own red suite),
  `godot-testing` (write REAL assertions on the REAL call path, not stubs),
  `godot-code-review` (self-review before you report), `karpathy-guidelines`
  (no silent assumptions, simplest implementation, surgical diffs — per the
  harmony mends above).
- **Specialty (code):** `gdscript-patterns`, `gdscript-advanced`, `state-machine`,
  `event-bus`, `component-system`, `dependency-injection`, `resource-pattern`,
  `save-load`, `clean-code`, `clean-architecture`.
- **For an isometric, mobile, sim-heavy game:** also `2d-essentials`
  (iso-grid placement = base-building), `inventory-system` + `procedural-generation`
  (economy/upgrades/spread), `mobile-development` (touch input).
- **Cross-check (optional):** wshobson `godot-gdscript-patterns`.

### Animation Developer (juice / game-feel — sequential pass on the SAME files)
- **See-UI baseline:** `godot-ui`, `responsive-ui`, `references/godot-verify-playbook.md`
  — juice IS visual; you MUST drive the running game and confirm each reaction fires.
- **Code-quality baseline:** `godot-debugging` (a tween that doesn't fire is a bug to
  triage), `godot-testing` (keep the suite green — your nodes must not break logic),
  `godot-code-review` (self-review), `karpathy-guidelines` (surgical diffs — your
  whole role is rule 3; per the harmony mends above).
- **Specialty (motion):** `tween-animation`, `animation-system`, `particles-vfx`,
  `shader-basics`, `camera-system`, `emil-design-eng`.
- **Craft reference:** `references/game-feel.md`.

### Tester (the correctness gate — RAPID by default)
- **Code-quality baseline (its core):** `godot-testing`, `godot-code-review`,
  `godot-debugging`, `karpathy-guidelines` (judge the diff by rule 2/3: an
  overcomplicated or out-of-scope change is an NG even when green).
- **See-UI baseline:** `godot-ui`, `responsive-ui` — read the captured frame against
  the UI/mobile layout contract, not just "a window opened."
- **Rapid in-loop gate:** the default round is the simulation — headless suite +
  fresh source-render with the dev's `drive_<slug>.gd` (seconds, not minutes).
  `godot_verify.sh --deploy` (build+install+launch the FRESH APK, screencap the
  device) is reserved for **inherently device-specific** features — touch/
  multi-touch input, safe-area/DPI/resolution, on-device performance — not a
  per-round default; the thorough on-device pass is the Manager's Phase 4 final
  gate. It records WHICH fidelity it got and flags `UNVERIFIED`.
- **Recipe reference:** `references/godot-verify-playbook.md` (the headless-suite +
  screenshot/adb recipe — the gate's hands).

### Manager (you, main thread — orchestrator + the FINAL gate)
- **Orchestrate:** `mobile-development`, `export-pipeline`, `responsive-ui` at
  preflight for the mobile target.
- **See-UI + code-quality baseline (for the on-device final gate):** `godot-ui`,
  `references/godot-verify-playbook.md`, `godot-testing`, `godot-code-review`,
  `godot-debugging`, `karpathy-guidelines` — because the Manager runs a last,
  holistic round of testing/verification on the live device (his own
  `Bash`/`adb`/`Read`, never a spawned agent), and with the rapid in-loop gate
  Phase 4 is **the** thorough on-device pass: fresh deploy, real hardware,
  cross-feature. You write ZERO feature code; you load these to *judge*, not to
  build.

### Domain Architect (optional docs track)
- **Verify:** `godot-code-review`, `clean-code`.

### Performance (NOT a standing agent — skills the Logic Dev loads on demand)
- **Load when a feature is perf-sensitive:** `godot-optimization`, `multithreading`.
  Relevant on mobile with many sim entities. Promote to a dedicated agent later only if
  mobile perf becomes a recurring gate.

## The no-fallback contract (in every persona)

> Your companion skills are installed locally from source before you run — load them.
> If a skill you need is somehow absent, that is a blocker: report it, do not improvise
> a thinner substitute. Real-engine verification (headless suite + screenshot/on-device)
> is the non-negotiable, and the full companion skills are how each agent reaches the
> depth this skill promises.
