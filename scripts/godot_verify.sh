#!/usr/bin/env bash
# godot_verify.sh — the Godot-native verification gate for game-build-team.
#
# Replaces clone-team's agent-browser. Two jobs:
#   1) TESTS (the hard gate): run every tests/unit/test_*.gd headless, collect
#      failures, and scan stderr for "Parse Error" / "SCRIPT ERROR". Exit non-zero
#      if anything fails — that is what makes the Tester gate un-fakeable.
#   2) SCREENSHOT (advisory): capture one frame of the running game so the Tester
#      can check it against the design contract. Capture path, in order:
#        a) adb device if one is attached  (your on-device proof method)
#        b) real X display ($DISPLAY set)   (e.g. a desktop or remote VNC/RDP session)
#        c) xvfb-run if installed           (CI / headless box)
#        d) skip with a loud warning        (tests still gate; visual = manual)
#      Screenshot capture is BEST-EFFORT: a capture failure does NOT fail the
#      script (tests are the hard gate), but the Tester treats "no screenshot"
#      as "could not visually verify" — never as a silent pass.
#
# Usage:
#   bash godot_verify.sh --dir <projectDir> [--godot <bin>] [--tests-only]
#                        [--out <png>] [--quit-after <sec>]
# Exit code: 0 iff every test exited 0 and no parse/script error was seen.

set -uo pipefail

DIR="$(pwd)"
GODOT="${GODOT_BIN:-godot}"
TESTS_ONLY=0
OUT=""
QUIT_AFTER=8
SHOT_FRAMES=45   # frames to let the game settle before grabbing the buffer

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    --godot) GODOT="$2"; shift 2;;
    --tests-only) TESTS_ONLY=1; shift;;
    --out) OUT="$2"; shift 2;;
    --quit-after) QUIT_AFTER="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; shift;;
  esac
done

cd "$DIR" || { echo "godot_verify: cannot cd to $DIR" >&2; exit 2; }
command -v "$GODOT" >/dev/null 2>&1 || { echo "godot_verify: '$GODOT' not on PATH" >&2; exit 2; }

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
shopt -s nullglob
TESTS=(tests/unit/test_*.gd)
shopt -u nullglob
if [[ ${#TESTS[@]} -eq 0 ]]; then
  echo "godot_verify: no tests found at tests/unit/test_*.gd" | tee -a "$LOG"
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
# 2) SCREENSHOT — advisory (never fails the script)
# ---------------------------------------------------------------------------
echo "" | tee -a "$LOG"
echo "== game-build-team verify: SCREENSHOT -> $OUT ==" | tee -a "$LOG"
SHOT_OK=0

# (a) on-device via adb
if command -v adb >/dev/null 2>&1 && [[ -n "$(adb devices 2>/dev/null | sed -n '2,$p' | grep -w device)" ]]; then
  echo "screenshot: adb device detected — capturing on-device" | tee -a "$LOG"
  if adb exec-out screencap -p > "$OUT" 2>>"$LOG" && [[ -s "$OUT" ]]; then
    SHOT_OK=1
    echo "screenshot: captured from device" | tee -a "$LOG"
  else
    echo "screenshot: adb capture failed (is the game in the foreground on the device?)" | tee -a "$LOG"
  fi
fi

# (b)/(c) in-engine harness via real $DISPLAY or xvfb-run
if [[ $SHOT_OK -eq 0 ]]; then
  HARNESS="$DIR/_gbt_shot.gd"   # under project root => res://_gbt_shot.gd; removed after
  ABS_OUT="$OUT"
  cat > "$HARNESS" <<GDEOF
extends SceneTree
# TEMP screenshot harness written by game-build-team/scripts/godot_verify.sh.
# Loads the main scene, lets it settle, saves one frame, exits. Auto-deleted.
func _init() -> void:
	_run()
func _run() -> void:
	var scn = load("res://main.tscn")
	if scn == null:
		printerr("[gbt_shot] could not load res://main.tscn")
		quit(1); return
	get_root().add_child(scn.instantiate())
	for _i in ${SHOT_FRAMES}:
		await process_frame
	var img: Image = get_root().get_texture().get_image()
	var err := img.save_png("${ABS_OUT}")
	if err != OK:
		printerr("[gbt_shot] save_png failed: %d" % err)
		quit(1); return
	print("[gbt_shot] saved ${ABS_OUT}")
	quit(0)
GDEOF

  RUN_SHOT() { "$GODOT" --quit-after $((SHOT_FRAMES + 30)) --path "$DIR" --script "res://_gbt_shot.gd" >>"$LOG" 2>&1; }

  if [[ -n "${DISPLAY:-}" ]]; then
    echo "screenshot: using real display ($DISPLAY)" | tee -a "$LOG"
    RUN_SHOT && [[ -s "$OUT" ]] && SHOT_OK=1
  elif command -v xvfb-run >/dev/null 2>&1; then
    echo "screenshot: using xvfb-run" | tee -a "$LOG"
    xvfb-run -a "$GODOT" --quit-after $((SHOT_FRAMES + 30)) --path "$DIR" --script "res://_gbt_shot.gd" >>"$LOG" 2>&1
    [[ -s "$OUT" ]] && SHOT_OK=1
  else
    echo "screenshot: NO capture path (no adb device, no \$DISPLAY, no xvfb-run)." | tee -a "$LOG"
    echo "           Tests still gated. For visual verification install xvfb (sudo apt install xvfb)" | tee -a "$LOG"
    echo "           or attach a device, or run with a desktop session." | tee -a "$LOG"
  fi
  rm -f "$HARNESS" "$DIR/_gbt_shot.gd.uid" 2>/dev/null
fi

if [[ $SHOT_OK -eq 1 ]]; then
  echo "SCREENSHOT OK: $OUT" | tee -a "$LOG"
else
  echo "SCREENSHOT MISSING: visual check is MANUAL this round (tests still gated)" | tee -a "$LOG"
fi

# Exit reflects the HARD gate (tests). Screenshot is advisory.
[[ $SUITE_OK -eq 1 ]] && exit 0 || exit 1
