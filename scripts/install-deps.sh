#!/usr/bin/env bash
# install-deps.sh — install game-build-team's companion skills (vendored GodotPrompter).
#
# THESE SKILLS ARE REQUIRED, NOT OPTIONAL. The build agents load them by name for
# full-depth Godot domain guidance. There is NO fallback: the skill installs every
# vendored companion skill from source (this repo's vendor/) into the PROJECT-LOCAL
# .claude/skills/ on init, and the run does not proceed until all of them are present.
#
# IDEMPOTENT: anything already installed is detected and SKIPPED, never overwritten.
# Safe to re-run. No network needed — the source is vendored in this repo (pinned).
#
# Usage:
#   bash install-deps.sh --dir <project-root>   # install PROJECT-LOCAL into <root>/.claude/skills
#   bash install-deps.sh --dir <root> --check   # verify-only: report any missing, install nothing
#   bash install-deps.sh --global               # install into the user's global ~/.claude/skills
#
# Project-local by DEFAULT so a build never pollutes the user's global ~/.claude/skills.
# Precedence: CLAUDE_SKILLS_DIR > --global > --dir <p>/.claude/skills > ./.claude/skills
# Requires: nothing but coreutils (skills are copied from vendor/).
#
# EXIT CODES (so preflight/recon can gate on it — this is the enforcement):
#   0 — every vendored companion skill is present at the target.
#   1 — vendor/ source missing, OR (after install / under --check) one or more
#       companion skills are NOT present. The run MUST stop and fix this; degrading
#       to thinner reference docs is not allowed.

set -uo pipefail

CHECK=0; GLOBAL=0; PROJ_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check)   CHECK=1 ;;
    --global)  GLOBAL=1 ;;
    --dir)     PROJ_DIR="${2:-}"; shift ;;
    --dir=*)   PROJ_DIR="${1#--dir=}" ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_SKILLS="$SCRIPT_DIR/../vendor/godot-prompter/skills"

if [ -n "${CLAUDE_SKILLS_DIR:-}" ]; then SKILLS_DIR="$CLAUDE_SKILLS_DIR"
elif [ "$GLOBAL" = "1" ]; then SKILLS_DIR="$HOME/.claude/skills"
elif [ -n "$PROJ_DIR" ]; then SKILLS_DIR="$PROJ_DIR/.claude/skills"
else SKILLS_DIR="$PWD/.claude/skills"
fi
mkdir -p "$SKILLS_DIR"

if [ ! -d "$VENDOR_SKILLS" ]; then
  echo "ERROR: vendored GodotPrompter source not found at $VENDOR_SKILLS" >&2
  echo "The companion skills are REQUIRED and ship vendored in this repo. Re-fetch the source:" >&2
  echo "  git clone --depth 1 https://github.com/jame581/GodotPrompter, copy its skills/ into vendor/godot-prompter/skills/" >&2
  exit 1
fi

# Source-of-truth list: every vendored skill that has a SKILL.md.
expected=()
for skill_path in "$VENDOR_SKILLS"/*/; do
  [ -f "$skill_path/SKILL.md" ] || continue
  expected+=("$(basename "$skill_path")")
done
TOTAL=${#expected[@]}

installed=(); skipped=()
for name in "${expected[@]}"; do
  skill_path="$VENDOR_SKILLS/$name"
  if [ -e "$SKILLS_DIR/$name/SKILL.md" ]; then
    skipped+=("$name")
  elif [ "$CHECK" = "1" ]; then
    : # verify-only: count as missing below, write nothing
  else
    cp -r "$skill_path" "$SKILLS_DIR/$name"
    installed+=("$name")
  fi
done

# VERIFY: every expected companion skill must now be present at the target. This is
# the no-fallback gate — a missing skill is a hard failure, not a silent downgrade.
missing=()
for name in "${expected[@]}"; do
  [ -e "$SKILLS_DIR/$name/SKILL.md" ] || missing+=("$name")
done
present=$(( TOTAL - ${#missing[@]} ))

echo "GodotPrompter companion skills target: $SKILLS_DIR"
echo "  required: $TOTAL   present: $present   newly installed: ${#installed[@]}   already there: ${#skipped[@]}"
if [ "${#installed[@]}" -gt 0 ]; then echo "  installed: ${installed[*]}"; fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo "  MISSING (${#missing[@]}): ${missing[*]}" >&2
  if [ "$CHECK" = "1" ]; then
    echo "FAIL (--check): $present/$TOTAL companion skills present. Run install-deps.sh --dir <project> to install the rest from source." >&2
  else
    echo "FAIL: could not install $present/$TOTAL companion skills from vendor/. The run must NOT proceed (no fallback)." >&2
  fi
  exit 1
fi

echo "OK: all $TOTAL companion skills present at $SKILLS_DIR. Agents load them by name (no fallback)."
exit 0
