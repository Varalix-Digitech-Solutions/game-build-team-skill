#!/usr/bin/env bash
# install-deps.sh — install game-build-team's companion skills (vendored sources).
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
# Every vendored skill root (each contains <skill-name>/SKILL.md dirs). Adding a
# new vendored source = adding one path here.
VENDOR_ROOTS=(
  "$SCRIPT_DIR/../vendor/godot-prompter/skills"
  "$SCRIPT_DIR/../vendor/karpathy/skills"
)

if [ -n "${CLAUDE_SKILLS_DIR:-}" ]; then SKILLS_DIR="$CLAUDE_SKILLS_DIR"
elif [ "$GLOBAL" = "1" ]; then SKILLS_DIR="$HOME/.claude/skills"
elif [ -n "$PROJ_DIR" ]; then SKILLS_DIR="$PROJ_DIR/.claude/skills"
else SKILLS_DIR="$PWD/.claude/skills"
fi
mkdir -p "$SKILLS_DIR"

for root in "${VENDOR_ROOTS[@]}"; do
  if [ ! -d "$root" ]; then
    echo "ERROR: vendored skill source not found at $root" >&2
    echo "The companion skills are REQUIRED and ship vendored in this repo (see vendor/*/ATTRIBUTION.md to re-fetch)." >&2
    exit 1
  fi
done

# Source-of-truth list: every vendored skill (across all roots) that has a SKILL.md.
expected=(); src_paths=()
for root in "${VENDOR_ROOTS[@]}"; do
  for skill_path in "$root"/*/; do
    [ -f "$skill_path/SKILL.md" ] || continue
    expected+=("$(basename "$skill_path")")
    src_paths+=("${skill_path%/}")
  done
done
TOTAL=${#expected[@]}

installed=(); skipped=()
for i in "${!expected[@]}"; do
  name="${expected[$i]}"
  skill_path="${src_paths[$i]}"
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

echo "Companion skills (GodotPrompter + Karpathy) target: $SKILLS_DIR"
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
