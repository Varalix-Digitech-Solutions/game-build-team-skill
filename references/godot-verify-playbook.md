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

## 2. The screenshot (advisory, best-effort)

Headless Godot uses a **dummy renderer** → a `--headless` screenshot is blank.
Real pixels need a rendering context. The script tries, in order:

1. **adb device** — if a device is attached (`adb devices` shows `device`), grabs
   `adb exec-out screencap -p`. This is the on-device proof method already used in
   this project (OnePlus9). The game must be in the foreground on the device.
2. **real `$DISPLAY`** — if a desktop / remote (VNC/RDP) X session is present, runs the
   in-engine harness with the real display.
3. **xvfb-run** — virtual framebuffer (CI / headless box). Install with
   `sudo apt install xvfb`. Not present by default on this box.
4. **skip** — no capture path: tests still gate; the visual check is MANUAL that
   round. The script says so loudly; the Tester records the visual as UNVERIFIED,
   never a silent pass.

The in-engine harness is a temp `res://_gbt_shot.gd` the script writes, runs, and
deletes (clean-up-don't-stack): it loads `res://main.tscn`, waits ~45 frames for
the scene to settle, saves `get_root().get_texture().get_image().save_png(out)`,
and quits. Output lands at `.game-build-team/artifacts/screen.png` (override with
`--out`). The run log is `.game-build-team/artifacts/test-run.log`.

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

For autonomous runs that visually gate every round, do ONE of:
- keep a device attached (best — matches your shipping target), or
- `sudo apt install xvfb` (lets headless runs capture frames), or
- run from the desktop session so `$DISPLAY` is set.

Without one of these, the loop still runs and the test gate still protects logic;
only the per-round visual check degrades to manual.
