# Godot verify playbook — the gate's hands

This replaces clone-team's `agent-browser`. The Tester drives the **real running
game**, not still frames, through `scripts/godot_verify.sh`. Two parts: the hard
test gate, and the advisory screenshot.

## 1. The test gate (hard, un-fakeable)

The suite is the un-skippable part. Each test under `tests/unit/test_*.gd` is an
`extends SceneTree` script that:
- runs headless: `godot --headless --quit-after N --path <proj> --script res://tests/unit/test_X.gd`
- `quit(0)` on pass, `quit(1)` on fail
- prints `[name] PASSED` / `[name] FAILED: …`

`godot_verify.sh` runs every test, collects non-zero exits, AND scans stderr for
`Parse Error` / `SCRIPT ERROR` (a parse error can make a test "pass" by never
running its asserts — so a parse/script error is a failure even on exit 0). It
prints `SUITE GREEN: N/N` or `SUITE RED: …` and exits accordingly.

```bash
bash scripts/godot_verify.sh --dir /abs/path/to/your/godot-project               # suite + screenshot
bash scripts/godot_verify.sh --dir /abs/path/to/your/godot-project --tests-only  # suite only (fast, used by Developer)
```

There is **no aggregate runner** in this repo — the script loops the files
directly, so adding a new `tests/unit/test_*.gd` is automatically picked up. No
registration step.

## 2. The screenshot — fidelity-ordered, and HONEST about freshness

Headless Godot uses a **dummy renderer** → a `--headless` screenshot is blank, so
real pixels need either a real on-device app or an in-engine render. The trap this
skill exists to avoid: **screencapping the stale installed APK** and passing it off
as the feature you just built. So capture is **fidelity-ordered**, and the script
prints `SCREENSHOT SOURCE: <mode>` so the Tester records *which* fidelity it got.

| Mode | Flag | What it proves | Freshness |
|------|------|----------------|-----------|
| **deploy-fresh** | `--deploy` | the NEW code running on the real device | builds the APK from the CURRENT source, installs it, launches it, screencaps |
| **source-render** | *(default)* | the NEW code rendering in-engine | runs the current source tree via `$DISPLAY`/xvfb — always fresh |
| **none** | — | nothing | reported `VISUAL UNVERIFIED`, never a silent pass |

**deploy-fresh (`--deploy`) — the on-device proof, and now agents can run it too.**
There is no platform reason a build-loop agent can't drive the device: `adb` and
`godot --export` are ordinary shell commands, and agents have `Bash`. So the Tester
(or any agent) can build + install + launch the fresh APK and screencap it — the same
thing the Manager does by hand. Guarantees built in:
- **Never stale.** It builds the APK from the current source (preferring the project's
  own `tools/export-android.sh` if present, else `godot --headless --export-debug`),
  and only captures an APK built *at or after* this run started. If the build or
  `adb install` fails — including the known headless-Linux APK rough edge that falls
  back to a non-installable PCK — it **refuses to screencap the stale build** and
  falls through to source-render. A stale frame is never reported as on-device.
- **Serialized.** The one phone is a shared resource. Deploy holds a `flock` on
  `.game-build-team/device.lock`, so parallel features in a wave queue for the device
  instead of clobbering each other's install/launch.
- **Optional interaction.** `--drive-adb <tap-script.sh>` runs a script of
  `adb shell input …` taps after launch (place objects / enter connect-mode) so the
  frame is a real interaction state, not a boot screen. The script gets `$GBT_DEVICE`.

**source-render (default) — fast, fresh, parallel-safe.** A temp `res://_gbt_shot.gd`
the script writes, runs, and deletes (clean-up-don't-stack): it loads `res://main.tscn`,
waits ~45 frames to settle, saves the framebuffer PNG, quits — rendered via real
`$DISPLAY` (else `xvfb-run`; install with `sudo apt install xvfb`). Because it loads
the source tree, it ALWAYS reflects the code just written — this is what fixed the
old staleness bug. `--drive <res://driver.gd>` swaps in a feature-supplied
`extends SceneTree` driver (it reads its output path from `OS.get_environment("GBT_SHOT_OUT")`)
to script a place+capture instead of a boot frame.

Output lands at `.game-build-team/artifacts/screen.png` (override with `--out`);
the run log is `.game-build-team/artifacts/test-run.log`.

### The interaction driver (so the frame isn't a boot screen)

By default the capture is the **resting/boot frame** — `main_scene` loaded and settled.
A boot frame can't show "mid-drag / multi-object / connect-mode," so each visual
feature ships a **driver** the verify script auto-loads by slug when you pass
`--feature <slug>` (the build loop passes it automatically):

- **`tests/visual/drive_<slug>.gd`** — source-render. An `extends SceneTree` that loads
  the main scene, drives the feature to its key state **through the real input/API path**
  (no shortcuts), settles a few frames, saves the framebuffer, quits:

  ```gdscript
  extends SceneTree
  func _init() -> void:
  	var out := OS.get_environment("GBT_SHOT_OUT")
  	var scn = load(ProjectSettings.get_setting("application/run/main_scene"))
  	var root_scene = scn.instantiate()
  	get_root().add_child(root_scene)
  	# --- drive THIS feature to a representative state (real calls, not fixtures) ---
  	# e.g. place three objects, enter connect-mode … exactly as a player would
  	for _i in 60: await process_frame
  	get_root().get_texture().get_image().save_png(out)
  	quit()
  ```

- **`tests/visual/drive_<slug>.adb.sh`** — `--deploy` only. A few `adb shell input
  tap/swipe …` lines run after launch to reach the same state on-device; `$GBT_DEVICE`
  is the serial.

The **Logic Developer writes these** alongside the feature. No driver → the script logs
`RESTING boot frame` and the Tester treats an interaction-dependent feature as visually
under-verified. Explicit `--drive` / `--drive-adb` override the slug lookup.

### Path detection (no silent wrong-target captures)

The script reads the **real** main scene from `project.godot` (`run/main_scene`), not a
hardcoded `res://main.tscn`, and **discovers** `test_*.gd` anywhere under `tests/`/`test/`
if `tests/unit/` is empty — so a non-standard layout fails loudly (or is found), never
captures the wrong scene or silently runs zero tests.

> **Inner loop vs. final gate.** The build loop's default is **source-render** (fast,
> fresh, no device contention) — it fixed the stale-screenshot problem without a device
> at all. Reach for **`--deploy`** when on-device truth matters: the creative gate, a
> feature whose feel only reads on real hardware, or the Manager's final gate. The
> Manager's on-device pass is now a *confirmation*, not the only on-device touch.

## 3. What the Tester checks the screenshot against

The design contract (the project's `graphify-out/` or equivalent) + any mockup PNGs.
Check against whatever the contract fixes — typically:
- the project's **palette / brand / framing / target resolution** (read them from the
  contract; don't assume a specific one),
- the feature is actually visible and in the right place,
- not static-where-it-should-update; not off-brand; no overlap/clipping.

A frozen or off-brand screen is an NG even if the suite is green — tests catch logic,
the screenshot catches "renders wrong but passes tests", a common UI failure mode.

## 4. Recommended setup for full visual gating

The default **source-render** only needs a render context, so for fresh per-round
visuals do ONE of:
- run from the desktop session so `$DISPLAY` is set (best for the inner loop — fast), or
- `sudo apt install xvfb` (lets a headless box capture frames).

For **on-device** truth (`--deploy`): keep a device attached (`adb devices` shows
`device`) and have the export toolchain installed (the project's `tools/export-android.sh`
+ Android SDK). If the installable-APK build fails, `--deploy` falls back to source-render
and says so — it never reports the stale build.

Without ANY of these, the loop still runs and the test gate still protects logic;
only the per-round visual degrades to `VISUAL UNVERIFIED`, which the Tester flags for
the Manager — never a silent pass.

## 5. Tests must reproduce the REAL call timing

A green suite that seeds its own fixtures can hide a bug that only appears on the real
call path — e.g. an autoload not yet resolved, or a node read one frame before
`_ready`/the scene tree settles (a tree-timing bug can sail past a suite that never
exercises that timing). So every acceptance test must drive the feature **the way the
game does**: through the real autoloads/signals, awaiting the real frames, not a
hand-built shortcut. The Tester rejects a test whose pass doesn't depend on the real
timing (see `agents/tester.md`).
