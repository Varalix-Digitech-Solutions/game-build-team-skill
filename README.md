<div align="center">

# 👾<br/>🛠️

# game-build-team

### A dynamic, agentic build pipeline for Godot 4 / GDScript game features

**A coordinated team of AI agents builds your feature — and refuses to call it "done" until it's verified, on-device, and *fun*.**

[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-8A2BE2)](https://docs.claude.com/en/docs/claude-code)
[![Godot 4](https://img.shields.io/badge/Godot-4.x-478CBF?logo=godotengine&logoColor=white)](https://godotengine.org/)
[![Dynamic Workflow](https://img.shields.io/badge/Dynamic-Workflow-FF6F61)](#how-it-works)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![No Fallback](https://img.shields.io/badge/dependencies-no%20fallback-critical)](#dependencies)

⭐ **If this saves you from shipping a half-baked feature, please [star the repo](https://github.com/Varalix-Digitech-Solutions/game-build-team-skill) — it genuinely helps.** ⭐

</div>

---

## ⚡ Install

This is a [Claude Code](https://docs.claude.com/en/docs/claude-code) skill. Clone it into your project's skills directory:

**Recommended — install as a plugin** (one marketplace, one install, **auto-updates**). In Claude Code:

```
/plugin marketplace add Varalix-Digitech-Solutions/game-build-team-skill
/plugin install game-build-team@game-build-team
```

That's it — the `game-build-team` skill and the `/game-build-update` command register automatically. Plugin installs **auto-update** when a new version ships, and Claude Code surfaces an update prompt right below the chat box — no re-cloning. Run `/game-build-update` anytime to see what you're on vs. the latest. (Restart Claude Code if it doesn't show up immediately.)

On first invoke, the skill's **preflight installs everything else it needs** (see [Dependencies](#dependencies)) into your project — **project-local, never global**.

<details>
<summary><b>Alternative — manual install (no plugins)</b></summary>

```bash
git clone https://github.com/Varalix-Digitech-Solutions/game-build-team-skill.git
cp -r game-build-team-skill/skills/game-build-team <your-godot-project>/.claude/skills/game-build-team
# optional: the update command
cp game-build-team-skill/commands/game-build-update.md ~/.claude/commands/
```

A manual copy does **not** auto-update — run `/game-build-update` to check, or re-copy from the latest clone.
</details>

### ✅ Prerequisites

| You need | Why |
|----------|-----|
| **A defined feature spec** | This skill *builds*, it doesn't *design*. Your requirements / design contract must already exist and be shared with the project (e.g. a design doc, acceptance criteria, or a `graphify` knowledge graph). The team reads it as the source of truth — it will not invent scope. |
| **`godot` 4.x on `PATH`** | The build + headless test engine. |
| **`node`** | Powers durable state, capacity sizing, and reporting. |
| **`adb` / `xvfb` / a real `$DISPLAY`** *(for visual gating)* | On-device + screenshot verification. Tests still gate without them. |

> **Heads up:** if you don't have your feature requirements defined yet, define them first. The pipeline's whole value is verifying work *against a contract* — no contract, nothing to verify against.

### ▶️ Use

```bash
/game-build-team build the building-placement feature, and make it feel satisfying
/game-build-team continue          # resume a paused run
```

The Manager reads your design contract, extracts its invariants, then dispatches the team.

---

## 🧠 How it works

`game-build-team` is a **dynamic agentic workflow** — not a single agent improvising, but a **deterministic pipeline** of specialist agents with **two un-skippable quality gates**. Quality is *control flow*, not a judgment call.

It exists to kill one failure mode: an AI builds a feature, self-grades it "looks fine," and stops — no tests run, the screen never checked, the feel never judged.

### The phase machine

You (the main thread) are the **Manager**: you dispatch, you never write feature code. Every session follows one fixed phase machine:

```
0 ask user → 1 RECON ▶wf → (blockers? install first) → 2 plan → 3 BUILD ▶wf → 4 on-device gate → 5 finish + suggest next
```

The fan-out phases (**1 recon**, **3 build/verify**) run as **background Workflows** — governed, parallel, resumable, no scatter. The agents *never* run in your main chat; they run in a fixed pipeline beneath it. Inside Phase 3, each feature flows through:

```
brief → build logic → juice pass → 🧪 TEST GATE → 🎨 CREATIVE GATE → fix → (repeat) → done
```

### The team

| Agent | Runs | Owns |
|-------|------|------|
| 🎯 **Manager** (you) | main thread | context, dispatch, the final on-device gate, the user. **Zero feature code.** |
| 🔍 **Recon Analyst** | Phase 1, first | the status quo: tool-gap blockers, what's done vs left, reuse targets — read-only |
| 🎨 **Creative Director** | first + last | the feature brief (UX + interaction + juice plan) **and** the fun gate |
| ⚙️ **Logic Developer** | per feature | gameplay logic — state, economy, simulation, input |
| ✨ **Animation Developer** | after logic | the juice / game-feel pass on the *same* files — feedback only |
| 🧪 **Tester** | the gate | full regression: headless suite + on-device screenshot vs the design contract + invariants |

### Two gates, both control flow

1. **🧪 Test gate** — the headless GDScript suite exits 0, acceptance criteria are asserted, a **fresh on-device screenshot** matches the design contract, invariants hold. Otherwise the feature doesn't advance.
2. **🎨 Creative gate** — once correct, the running feature is judged against its brief: *readable / responsive / satisfying / on-theme / fair.*

Then the Manager runs a **cross-feature on-device final gate** — a real-hand pass over the whole delivery. The in-Workflow Tester already verifies each feature on the live device itself (`godot_verify.sh --deploy` builds, installs, and launches the fresh APK); the Manager's pass confirms they work *together*.

### Deterministic order, dynamic scale

The step order is fixed, but how many features build in parallel is **sized to your host** (`scripts/capacity.mjs`) so a constrained machine never gets OOM-killed. The whole run is **resumable** across pauses and usage-limit cutoffs via durable state.

---

## 📦 Dependencies

On invoke, preflight installs **48 companion Godot skills** ([GodotPrompter](https://github.com/jame581/GodotPrompter), MIT) from the repo's pinned `vendor/` into your project's `.claude/skills/` — **project-local, never global** — and **refuses to run until every one is present**:

```bash
bash skills/game-build-team/scripts/install-deps.sh --dir /abs/path/to/your/godot-project   # run by preflight; exits non-zero if any dep is missing
```

These companion skills are **required, not optional** — they're how each agent reaches full Godot domain depth.

> **There is no fallback.** A missing companion skill is a hard blocker that stops the run, never a silent downgrade. The bundled `references/*.md` are craft references the agents cite *alongside* the skills — not stand-ins for them. Fallbacks make a skill quietly worse; this one fails loud instead.

---

## 🗂️ Layout

```
.claude-plugin/          plugin + marketplace manifests (what makes it a one-command install)
commands/                /game-build-update — version-aware updater
skills/game-build-team/   the skill itself:
  SKILL.md                 the Manager's operating manual (the entry point)
  agents/                  the six spawn personas (single source of truth)
  workflows/               recon.js (Phase 1) + game-build-loop.js (Phase 3, the two-gate loop)
  references/              orchestration, skill map, verify playbook, game-feel, resume
  scripts/                 durable state, dynamic capacity probe, verify gate, installer
  vendor/godot-prompter/   vendored GodotPrompter skills (MIT)
  evals/                   behavioral evals for the skill
```

---

## 🙏 Credits

- Build/verify engine and resumable-Workflow pattern adapted from the **`clone-team`** skill.
- Godot domain skills vendored from [jame581/GodotPrompter](https://github.com/jame581/GodotPrompter) (MIT) — see `vendor/godot-prompter/ATTRIBUTION.md`.

## 📄 License

MIT — see [LICENSE](LICENSE). Vendored components retain their own licenses.

---

<div align="center">

**Built something fun with it?** ⭐ [Star the repo](https://github.com/Varalix-Digitech-Solutions/game-build-team-skill) and let the next dev find it.

</div>
