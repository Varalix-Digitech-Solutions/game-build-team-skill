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
| **Verify / review** — code quality + anti-patterns | `godot-code-review`, `clean-code` |
| **Code** — gameplay logic & systems | `gdscript-patterns`, `gdscript-advanced`, `state-machine`, `event-bus`, `component-system`, `dependency-injection`, `resource-pattern`, `save-load` + `clean-code`, `clean-architecture` |
| **Design / UX** — fun, feel, interaction | `emil-design-eng`, `2d-essentials`, `godot-ui`, `godot-brainstorming`, `brainstorming` |
| **Orchestrate** — mobile target, pipeline, requirements | `mobile-development`, `export-pipeline`, `responsive-ui` |

## The shared baseline (the overlap, made explicit)

Two bundles are loaded by *multiple* agents — this is the intentional overlap:

- **See-UI bundle** (`godot-ui`, `responsive-ui`, `references/godot-verify-playbook.md`)
  — loaded by **every** agent that touches or inspects the running game:
  Creative Director, Logic Developer, Animation Developer, Tester, Manager. Nobody
  on this team is allowed to be blind to what the game actually renders.
- **Code-quality bundle** (`godot-debugging`, `godot-testing`, `godot-code-review`)
  — loaded by every agent that writes, breaks, or judges code:
  Logic Developer, Animation Developer, Tester, Manager. The Logic Dev writes the
  tests the Tester runs and debugs its own red suite; the Manager re-tests and
  re-verifies at the final gate; the Tester owns all three. Same skills, same team.

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
  `godot-code-review` (self-review before you report).
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
  `godot-code-review` (self-review).
- **Specialty (motion):** `tween-animation`, `animation-system`, `particles-vfx`,
  `shader-basics`, `camera-system`, `emil-design-eng`.
- **Craft reference:** `references/game-feel.md`.

### Tester (the correctness gate)
- **Code-quality baseline (its core):** `godot-testing`, `godot-code-review`,
  `godot-debugging`.
- **See-UI baseline:** `godot-ui`, `responsive-ui` — read the captured frame against
  the UI/mobile layout contract, not just "a window opened."
- **On-device proof:** can run `godot_verify.sh --deploy` to build+install+launch the
  FRESH APK and screencap the real device; default is the fresh source-render. It
  records WHICH fidelity it got and flags `UNVERIFIED`.
- **Recipe reference:** `references/godot-verify-playbook.md` (the headless-suite +
  screenshot/adb recipe — the gate's hands).

### Manager (you, main thread — orchestrator + the FINAL gate)
- **Orchestrate:** `mobile-development`, `export-pipeline`, `responsive-ui` at
  preflight for the mobile target.
- **See-UI + code-quality baseline (for the on-device final gate):** `godot-ui`,
  `references/godot-verify-playbook.md`, `godot-testing`, `godot-code-review`,
  `godot-debugging` — because the Manager runs a last, holistic round of
  testing/verification on the live device (his own `Bash`/`adb`/`Read`, never a spawned
  agent). You write ZERO feature code; you load these to *judge*, not to build.

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
