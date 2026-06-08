# game-build-team

A Claude Code skill that builds **Godot 4 / GDScript game features** with a
coordinated team of AI agents — and refuses to call a feature "done" until it is
**verified and fun**.

It exists to kill one failure mode: an AI builds a feature, self-grades it
"looks fine", and stops — no tests run, the screen never checked, the feel never
judged. Here the build loop is a **deterministic Workflow** with **two
un-skippable gates**, so quality is control flow, not a judgment call.

## How it works

You (the main thread) are the **Manager** — you dispatch, you never write feature
code. The Workflow spawns four specialists, each in its own thread, and runs a
fixed pipeline per feature:

```
brief → build logic → juice pass → TEST GATE → CREATIVE GATE → fix → (repeat) → done
```

| Agent | Runs | Owns |
|-------|------|------|
| **Manager** (you) | main thread | context, dispatch, the final on-device gate. **Zero feature code.** |
| **Creative Director** | first + last | the feature brief (UX + interaction model + juice plan) **and** the fun gate |
| **Logic Developer** | per feature | gameplay logic — state, economy, simulation, input |
| **Animation Developer** | after logic | the juice / game-feel pass on the *same* files — feedback only |
| **Tester** | the gate | full regression: headless suite + screenshot vs the design contract + invariants |

**Two gates, both control flow:**
1. **Test gate** (Tester) — the headless GDScript suite exits 0, acceptance
   criteria are asserted, the screenshot matches the design contract, invariants
   hold. Otherwise the feature doesn't advance.
2. **Creative gate** (Creative Director) — once correct, the running feature is
   judged against its brief (readable / responsive / satisfying / on-theme / fair).

Then the Manager runs an **on-device final gate** — the one check the in-Workflow
Tester can't do, because it can't see the live game.

**Deterministic order, dynamic scale.** The step order is fixed, but how many
features build in parallel is sized to the host (`scripts/capacity.mjs`) so a
constrained box never gets OOM-killed. The whole run is **resumable** across
pauses and usage-limit cutoffs via durable state.

## Install

This is a Claude Code skill. Drop it into your skills directory (e.g.
`<project>/.claude/skills/game-build-team/` or `~/.claude/skills/`), then provision
the agents' companion Godot skills into your project:

```bash
bash scripts/install-deps.sh --dir /abs/path/to/your/godot-project
```

That copies the vendored [GodotPrompter](https://github.com/jame581/GodotPrompter)
skills (MIT) into the project's `.claude/skills/` so each agent can load the Godot
knowledge it needs. If a skill is missing, agents **degrade gracefully** to the
bundled `references/*.md` — a run never hard-fails on a missing dependency.

**Requirements:** `godot` 4.x on PATH, `node` (for `state.mjs` / `capacity.mjs`),
and — for visual gating — `adb`, `xvfb`, or a real `$DISPLAY` (tests still gate
without them).

## Use

In Claude Code:

```
/game-build-team build the building-placement feature, and make it feel satisfying
/game-build-team continue          # resume a paused run
```

The Manager reads your project's design contract, extracts its invariants, gathers
requirements, then dispatches the team. See `SKILL.md` for the full operating model.

## Layout

```
SKILL.md                 the Manager's operating manual (the entry point)
agents/                  the five spawn personas (single source of truth)
workflows/               the enforcement engine (the two-gate loop)
references/              orchestration, skill map, verify playbook, game-feel, resume
scripts/                 durable state, dynamic capacity probe, verify gate, installer
vendor/godot-prompter/   vendored GodotPrompter skills (MIT)
evals/                   behavioral evals for the skill
```

## Credits

- Build/verify engine and resumable-Workflow pattern adapted from the
  `clone-team` skill.
- Godot domain skills vendored from
  [jame581/GodotPrompter](https://github.com/jame581/GodotPrompter) (MIT) — see
  `vendor/godot-prompter/ATTRIBUTION.md`.

## License

MIT — see [LICENSE](LICENSE). Vendored components retain their own licenses.
