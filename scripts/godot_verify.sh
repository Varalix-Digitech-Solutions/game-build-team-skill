#!/usr/bin/env bash
# godot_verify.sh — the Godot-native verification gate for game-build-team.
#
# Replaces clone-team's agent-browser. Two jobs:
#   1) TESTS (the hard gate): run every tests/unit/test_*.gd headless, collect
#      failures, and scan stderr for "Parse Error" / "SCRIPT ERROR". Exit non-zero
#      if anything fails — that is what makes the Tester gate un-fakeable.
#   2) SCREENSHOT (advisory): capture one frame so the Tester can check it
#      against the design contract. FIDELITY-ORDERED — capture the highest
#      fidelity available and REPORT which one, so a fresh frame is never
#      confused with a stale one or a boot frame:
#        deploy-fresh  (--deploy): build the APK from the CURRENT source, install
#                      it, launch it, screencap the real device. Proves the NEW
#                      code on real hardware. Serialized on a device lock so
#                      parallel features don't clobber the one phone. If the build
#                      or install fails, it REFUSES to screencap the stale installed
#                      build — it falls through to source-render instead.
#        source-render (default): run the fresh source tree in-engine via real
#                      $DISPLAY, else xvfb-run. Always reflects the code just
#                      written; parallel-safe. Optional --drive res://driver.gd
#                      scripts an interaction (place objects / enter a mode)
#                      instead of a static boot frame.
#        none          no capture path -> reported VISUAL UNVERIFIED (never a pass).
#      Capture is BEST-EFFORT: a capture failure does NOT fail the script (tests
#      are the hard gate). The script prints "SCREENSHOT SOURCE: <mode>" so the
#      Tester records which fidelity it actually got.
#
# Usage:
#   bash godot_verify.sh --dir <projectDir> [--godot <bin>] [--tests-only]
#                        [--out <png>] [--quit-after <sec>]
#                        [--deploy] [--preset <name>] [--package <id>]
#                        [--feature <slug>] [--drive <res://driver.gd>] [--drive-adb <tap-script.sh>]
# --feature <slug> auto-loads tests/visual/drive_<slug>.gd (source-render) and
#   tests/visual/drive_<slug>.adb.sh (--deploy) so the frame shows the feature
#   mid-interaction instead of a boot frame. Explicit --drive / --drive-adb win.
# Exit code: 0 iff every test exited 0 and no parse/script error was seen.

set -uo pipefail

DIR="$(pwd)"
GODOT="${GODOT_BIN:-godot}"
TESTS_ONLY=0
OUT=""
QUIT_AFTER=8
SHOT_FRAMES=45   # frames to let the game settle before grabbing the buffer
DEPLOY=0         # --deploy: build+install+launch the CURRENT code on a real device
PRESET="Android" # export preset used by --deploy
PKG=""           # android package id; derived from export_presets.cfg if empty
DRIVE_RES=""     # res:// path to an `extends SceneTree` driver for source-render
DRIVE_ADB=""     # path to a shell script of `adb shell input ...` taps for --deploy
FEATURE_SLUG=""  # if set, auto-resolves a tests/visual/drive_<slug>.{gd,adb.sh} driver

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    --godot) GODOT="$2"; shift 2;;
    --tests-only) TESTS_ONLY=1; shift;;
    --out) OUT="$2"; shift 2;;
    --quit-after) QUIT_AFTER="$2"; shift 2;;
    --deploy|--on-device) DEPLOY=1; shift;;
    --preset) PRESET="$2"; shift 2;;
    --package) PKG="$2"; shift 2;;
    --drive) DRIVE_RES="$2"; shift 2;;
    --drive-adb) DRIVE_ADB="$2"; shift 2;;
    --feature) FEATURE_SLUG="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; shift;;
  esac
done

cd "$DIR" || { echo "godot_verify: cannot cd to $DIR" >&2; exit 2; }
command -v "$GODOT" >/dev/null 2>&1 || { echo "godot_verify: '$GODOT' not on PATH" >&2; exit 2; }

# Derive the android package id from the project's export presets if not given.
if [[ -z "$PKG" && -f "$DIR/export_presets.cfg" ]]; then
  PKG="$(grep -oE 'package/unique_name="[^"]+"' "$DIR/export_presets.cfg" | head -n1 | cut -d'"' -f2)"
fi

# Derive the REAL main scene from project.godot (don't assume res://main.tscn).
MAIN_SCENE="res://main.tscn"
if [[ -f "$DIR/project.godot" ]]; then
  ms="$(grep -oE 'run/main_scene="[^"]+"' "$DIR/project.godot" | head -n1 | cut -d'"' -f2)"
  [[ -n "$ms" ]] && MAIN_SCENE="$ms"
fi

# Auto-resolve a per-feature interaction driver by slug (explicit --drive wins).
# Convention: tests/visual/drive_<slug>.gd  (SceneTree, for source-render)
#             tests/visual/drive_<slug>.adb.sh (adb input taps, for --deploy)
if [[ -n "$FEATURE_SLUG" ]]; then
  [[ -z "$DRIVE_RES" && -f "$DIR/tests/visual/drive_${FEATURE_SLUG}.gd" ]] && DRIVE_RES="res://tests/visual/drive_${FEATURE_SLUG}.gd"
  [[ -z "$DRIVE_ADB" && -f "$DIR/tests/visual/drive_${FEATURE_SLUG}.adb.sh" ]] && DRIVE_ADB="$DIR/tests/visual/drive_${FEATURE_SLUG}.adb.sh"
fi

ART_DIR="$DIR/.game-build-team/artifacts"
mkdir -p "$ART_DIR"
[[ -z "$OUT" ]] && OUT="$ART_DIR/screen.png"
LOG="$ART_DIR/test-run.log"
: > "$LOG"

# ---------------------------------------------------------------------------
# 1) TESTS — the hard gate
# ---------------------------------------------------------------------------
echo "== game-build-team verify: TESTS ==" | tee -a "$LOG"
FAILED=()
PARSE_ERR=0
# Prefer the conventional tests/unit/, but DISCOVER test_*.gd anywhere if that's
# empty — so tests in tests/, test/, or nested dirs aren't silently skipped.
shopt -s nullglob
TESTS=(tests/unit/test_*.gd)
shopt -u nullglob
if [[ ${#TESTS[@]} -eq 0 ]]; then
  mapfile -t TESTS < <(find tests test -type f -name 'test_*.gd' 2>/dev/null | sed 's#^\./##' | sort)
fi
if [[ ${#TESTS[@]} -eq 0 ]]; then
  echo "godot_verify: WARNING — no test_*.gd found under tests/ or test/. The hard gate has NOTHING to assert." | tee -a "$LOG"
else
  echo "godot_verify: discovered ${#TESTS[@]} test file(s)" | tee -a "$LOG"
fi

for t in "${TESTS[@]}"; do
  res="res://${t}"
  out="$("$GODOT" --headless --quit-after "$QUIT_AFTER" --path "$DIR" --script "$res" 2>&1)"
  code=$?
  echo "----- $t (exit $code) -----" >> "$LOG"
  echo "$out" >> "$LOG"
  if echo "$out" | grep -qE "Parse Error|SCRIPT ERROR"; then
    PARSE_ERR=$((PARSE_ERR+1))
    FAILED+=("$t [parse/script error]")
  elif [[ $code -ne 0 ]]; then
    FAILED+=("$t [exit $code]")
  fi
done

NTEST=${#TESTS[@]}
NFAIL=${#FAILED[@]}
echo "" | tee -a "$LOG"
if [[ $NFAIL -eq 0 ]]; then
  echo "SUITE GREEN: $NTEST/$NTEST passed, 0 parse/script errors" | tee -a "$LOG"
  SUITE_OK=1
else
  echo "SUITE RED: $NFAIL/$NTEST failed (parse/script errors: $PARSE_ERR)" | tee -a "$LOG"
  printf '  FAIL: %s\n' "${FAILED[@]}" | tee -a "$LOG"
  SUITE_OK=0
fi

if [[ $TESTS_ONLY -eq 1 ]]; then
  [[ $SUITE_OK -eq 1 ]] && exit 0 || exit 1
fi

# ---------------------------------------------------------------------------
# 2) SCREENSHOT — advisory (never fails the script), fidelity-ordered
# ---------------------------------------------------------------------------
echo "" | tee -a "$LOG"
echo "== game-build-team verify: SCREENSHOT -> $OUT ==" | tee -a "$LOG"
SHOT_OK=0
SHOT_SOURCE="none"

# --- source-render: a FRESH in-engine frame from the current source tree ------
# Reflects the code just written (loads res://main.tscn, or a --drive driver).
render_source() {
  local driver="$1"   # res:// path to an `extends SceneTree` driver, or "" for default
  local script_res
  if [[ -n "$driver" ]]; then
    script_res="$driver"
    echo "screenshot[source]: DRIVEN by $driver (interaction state)" | tee -a "$LOG"
  else
    if [[ -n "$FEATURE_SLUG" ]]; then
      echo "screenshot[source]: NOTE — no driver tests/visual/drive_${FEATURE_SLUG}.gd; capturing a RESTING boot frame, not the feature mid-interaction" | tee -a "$LOG"
    fi
    cat > "$DIR/_gbt_shot.gd" <<GDEOF
extends SceneTree
# TEMP screenshot harness written by game-build-team/scripts/godot_verify.sh.
# Loads the main scene from the CURRENT source tree, lets it settle, saves one
# frame to \$GBT_SHOT_OUT, exits. Auto-deleted. This frame reflects code just written.
func _init() -> void:
	_run()
func _run() -> void:
	var out := OS.get_environment("GBT_SHOT_OUT")
	var scn = load("${MAIN_SCENE}")
	if scn == null:
		printerr("[gbt_shot] could not load ${MAIN_SCENE}")
		quit(1); return
	get_root().add_child(scn.instantiate())
	for _i in ${SHOT_FRAMES}:
		await process_frame
	var img: Image = get_root().get_texture().get_image()
	var err := img.save_png(out)
	if err != OK:
		printerr("[gbt_shot] save_png failed: %d" % err)
		quit(1); return
	print("[gbt_shot] saved %s" % out)
	quit(0)
GDEOF
    script_res="res://_gbt_shot.gd"
  fi

  if [[ -n "${DISPLAY:-}" ]]; then
    echo "screenshot[source]: real display ($DISPLAY)" | tee -a "$LOG"
    GBT_SHOT_OUT="$OUT" "$GODOT" --quit-after $((SHOT_FRAMES + 60)) --path "$DIR" --script "$script_res" >>"$LOG" 2>&1
  elif command -v xvfb-run >/dev/null 2>&1; then
    echo "screenshot[source]: xvfb-run" | tee -a "$LOG"
    GBT_SHOT_OUT="$OUT" xvfb-run -a "$GODOT" --quit-after $((SHOT_FRAMES + 60)) --path "$DIR" --script "$script_res" >>"$LOG" 2>&1
  else
    echo "screenshot[source]: NO render path (no \$DISPLAY, no xvfb-run). Install xvfb or run from a desktop session." | tee -a "$LOG"
  fi
  rm -f "$DIR/_gbt_shot.gd" "$DIR/_gbt_shot.gd.uid" 2>/dev/null
  [[ -s "$OUT" ]] && { SHOT_OK=1; SHOT_SOURCE="source-render"; }
}

# --- deploy-fresh: build+install+launch the CURRENT code, capture on device ---
# The ONLY mode that proves new code on real hardware. Serialized on a device
# lock. NEVER screencaps a stale build: if the fresh APK can't be produced or
# installed, it returns empty-handed and the caller falls back to source-render.
deploy_capture() {
  command -v adb >/dev/null 2>&1 || { echo "screenshot[deploy]: adb not on PATH" | tee -a "$LOG"; return; }
  local dev; dev="$(adb devices 2>/dev/null | sed -n '2,$p' | grep -w device | head -n1 | cut -f1)"
  [[ -z "$dev" ]] && { echo "screenshot[deploy]: no device attached" | tee -a "$LOG"; return; }

  # Serialize on a device lock so parallel features never clobber the one phone.
  exec 9>"$DIR/.game-build-team/device.lock"
  flock 9 2>/dev/null || true

  echo "screenshot[deploy]: device $dev — building FRESH APK from source" | tee -a "$LOG"
  local start_ts; start_ts=$(date +%s)
  if [[ -x "$DIR/tools/export-android.sh" ]]; then
    ( cd "$DIR" && bash tools/export-android.sh ) >>"$LOG" 2>&1   # project script knows the preset + fallbacks
  else
    ( cd "$DIR" && "$GODOT" --headless --export-debug "$PRESET" "build/android/gbt-deploy.apk" ) >>"$LOG" 2>&1
  fi

  # An INSTALLABLE apk built at/after this run started — not a stale leftover.
  local apk; apk="$(find "$DIR/build" -name '*.apk' -newermt "@$((start_ts - 2))" 2>/dev/null | head -n1)"
  if [[ -z "$apk" || ! -s "$apk" ]]; then
    echo "screenshot[deploy]: no fresh APK produced (known headless rough edge?) — NOT capturing stale build" | tee -a "$LOG"
    flock -u 9 2>/dev/null || true; return
  fi
  echo "screenshot[deploy]: installing $apk" | tee -a "$LOG"
  if ! adb -s "$dev" install -r "$apk" >>"$LOG" 2>&1; then
    echo "screenshot[deploy]: adb install failed — NOT capturing stale build" | tee -a "$LOG"
    flock -u 9 2>/dev/null || true; return
  fi
  echo "screenshot[deploy]: launching $PKG" | tee -a "$LOG"
  adb -s "$dev" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >>"$LOG" 2>&1
  sleep 4   # let the app reach its first interactive frame
  if [[ -n "$DRIVE_ADB" && -f "$DRIVE_ADB" ]]; then
    echo "screenshot[deploy]: running input driver $DRIVE_ADB" | tee -a "$LOG"
    GBT_DEVICE="$dev" bash "$DRIVE_ADB" >>"$LOG" 2>&1 || true   # place objects / enter a mode
  fi
  if adb -s "$dev" exec-out screencap -p > "$OUT" 2>>"$LOG" && [[ -s "$OUT" ]]; then
    SHOT_OK=1; SHOT_SOURCE="deploy-fresh"
    echo "screenshot[deploy]: captured FRESH on-device frame" | tee -a "$LOG"
  else
    echo "screenshot[deploy]: screencap failed (game not foreground?)" | tee -a "$LOG"
  fi
  flock -u 9 2>/dev/null || true
}

if [[ $DEPLOY -eq 1 ]]; then
  deploy_capture
fi
if [[ $SHOT_OK -eq 0 ]]; then
  [[ $DEPLOY -eq 1 ]] && echo "screenshot: on-device unavailable — falling back to FRESH source render" | tee -a "$LOG"
  render_source "$DRIVE_RES"
fi

if [[ $SHOT_OK -eq 1 ]]; then
  echo "SCREENSHOT OK ($SHOT_SOURCE): $OUT" | tee -a "$LOG"
else
  echo "SCREENSHOT MISSING: VISUAL UNVERIFIED this round (tests still gated)" | tee -a "$LOG"
fi
echo "SCREENSHOT SOURCE: $SHOT_SOURCE" | tee -a "$LOG"   # deploy-fresh | source-render | none

# Exit reflects the HARD gate (tests). Screenshot is advisory.
[[ $SUITE_OK -eq 1 ]] && exit 0 || exit 1
