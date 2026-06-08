# Skills each agent loads (and how it degrades)

The single source of truth for **which Claude skills each agent loads before doing
any work**, and what it falls back to when a skill isn't installed. Every persona
opens with "load these; if absent, degrade." This file is what `install-deps.sh`
provisions and what the Manager points agents at.

## Where the skills come from

| Source | What | Stars | How we use it |
|--------|------|-------|---------------|
| **vendored GodotPrompter** (`vendor/godot-prompter/`) | 48 Godot 4.x domain skills (MIT) | jame581/GodotPrompter | `install-deps.sh` copies them PROJECT-LOCAL into `<proj>/.claude/skills/`. Primary Godot knowledge. |
| **wshobson/agents** `godot-gdscript-patterns` | high-credibility GDScript patterns | 36.5k | Optional cross-check for the Logic Developer; not vendored (load if globally installed). |
| **already-installed, engine-agnostic** | `clean-code`, `clean-architecture`, `brainstorming`, `emil-design-eng` | anthropics / community | Taste + discipline layers; loaded directly, no install. |
| **this skill's `references/`** | `game-feel.md`, `godot-verify-playbook.md` | — | The DEGRADE target: bundled craft docs so a missing skill never hard-fails a run. |

Web/CSS skills from clone-team (`ui-pack`, `agent-browser`, `ui-animation`,
Remotion) are **not used** — wrong engine. Godot animates via `Tween` /
`AnimationPlayer` / `GPUParticles` / shaders, verified by screenshot, not a browser.

## Per-agent load list

Each agent's first move: try to load the listed skills; on any miss, fall back to
the degrade target and keep going (never abort).

### Creative Director (the creative agent — runs first, also the fun gate)
- **Load:** `godot-brainstorming`, `brainstorming`, `emil-design-eng`, `2d-essentials`
- **Why:** ideate within real Godot/engine constraints (`godot-brainstorming`),
  structured intent exploration (`brainstorming`), UX-feel taste (`emil-design-eng`),
  isometric/tilemap feasibility so "fun" ideas are buildable on the grid (`2d-essentials`).
- **Degrade to:** `references/game-feel.md`.

### Logic Developer (gameplay systems / state / economy / simulation)
- **Load:** `gdscript-patterns`, `gdscript-advanced`, `state-machine`, `event-bus`,
  `component-system`, `dependency-injection`, `resource-pattern`, `save-load`,
  `clean-code`, `clean-architecture`
- **For this game (CoC + Plague, isometric, mobile):** also `2d-essentials`
  (iso-grid placement = base-building), `inventory-system` + `procedural-generation`
  (economy/upgrades/spread), `mobile-development` (touch input).
- **Cross-check (optional):** wshobson `godot-gdscript-patterns`.
- **Degrade to:** existing project code + the design contract (read, don't guess).

### Animation Developer (juice / game-feel — sequential pass on the SAME files)
- **Load:** `tween-animation`, `animation-system`, `particles-vfx`, `shader-basics`,
  `camera-system`, `emil-design-eng`
- **Why:** `camera-system` = screen-shake / zoom punch; `particles-vfx` =
  building-place dust, infection-spread FX; `tween-animation`/`animation-system` =
  easing, transitions, feedback.
- **Degrade to:** `references/game-feel.md`.

### Tester (the correctness gate)
- **Load:** `godot-testing`, `godot-code-review`, `godot-debugging`
- **Degrade to:** `references/godot-verify-playbook.md` (the headless-suite +
  screenshot recipe — already the gate's hands).

### Domain Architect (optional docs track)
- **Load:** `godot-code-review`
- **Degrade to:** plain clean-code discipline.

### Performance (NOT a standing agent — skills the Logic Dev loads on demand)
- **Load when a feature is perf-sensitive:** `godot-optimization`, `multithreading`.
  Relevant on mobile with many sim entities (Plague spread, CoC unit counts).
  Promote to a dedicated agent later only if mobile perf becomes a recurring gate.

### Manager (you, main thread — orchestrator, no feature skills)
- At preflight reads `mobile-development`, `export-pipeline`, `responsive-ui` for
  the mobile target. Writes ZERO feature code; only routes context between agents.

## The degrade contract (in every persona)

> Try to load `<skill>`. If it is NOT installed, DO NOT abort — read
> `references/<fallback>.md` and proceed. Real-engine verification (headless suite
> + screenshot) is the non-negotiable, not the skill wrapper.
