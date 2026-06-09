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
code. The whole run follows one fixed **phase machine**, every session:

```
0 ask user → 1 RECON ▶wf → (blockers? install first) → 2 plan → 3 BUILD ▶wf → 4 on-device gate → 5 finish + suggest next
```

The fan-out phases (**1 recon**, **3 build/verify**) are **Workflows** — governed,
resumable, no scatter. The other phases stay in your thread because they need the user
or a live device, but they're fixed scripted steps, not improvisation. Inside Phase 3,
the pipeline per feature is:

```
brief → build logic → juice pass → TEST GATE → CREATIVE GATE → fix → (repeat) → done
```

| Agent | Runs | Owns |
|-------|------|------|
| **Manager** (you) | main thread | context, dispatch, the final on-device gate, the user. **Zero feature code.** |
| **Recon Analyst** | Phase 1, first | the status quo: tool-gap blockers, what's done vs left, reuse targets — read-only |
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

Then the Manager runs an **on-device final gate** — a holistic, real-hand pass over the
whole delivery. The in-Workflow Tester already verifies each feature on the live device
itself (`godot_verify.sh --deploy` builds+installs+launches the fresh APK); the Manager's
pass is the *cross-feature* confirmation on top.

**Deterministic order, dynamic scale.** The step order is fixed, but how many
features build in parallel is sized to the host (`scripts/capacity.mjs`) so a
constrained box never gets OOM-killed. The whole run is **resumable** across
pauses and usage-limit cutoffs via durable state.

## Install

This is a Claude Code skill. Get it into your skills directory — clone the repo into
`<project>/.claude/skills/game-build-team/` (or `~/.claude/skills/`):

```bash
git clone https://github.com/Varalix-Digitech-Solutions/game-build-team-skill \
  <project>/.claude/skills/game-build-team
```

On invoke, the skill's **preflight installs all 48 companion Godot skills from source**
(the repo's pinned `vendor/`) into your project's `.claude/skills/` — **project-local,
never global** — and **refuses to run until every one is present**:

```bash
bash scripts/install-deps.sh --dir /abs/path/to/your/godot-project   # run by preflight; exits non-zero if any dep is missing
```

These companion skills ([GodotPrompter](https://github.com/jame581/GodotPrompter), MIT)
are **required, not optional** — they're how each agent reaches full Godot domain depth.
**There is no fallback:** a missing companion skill is a hard blocker that stops the run,
never a silent downgrade to the bundled `references/*.md` (those are craft references the
agents cite *alongside* the skills, not stand-ins for them).

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
agents/                  the six spawn personas (single source of truth)
workflows/               recon.js (Phase 1) + game-build-loop.js (Phase 3, the two-gate loop)
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
