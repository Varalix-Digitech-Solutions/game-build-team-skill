#!/usr/bin/env bash
# install-deps.sh — install game-build-team's companion skills (vendored GodotPrompter).
#
# IDEMPOTENT BY DESIGN: anything already installed is detected and SKIPPED, never
# overwritten. Safe to re-run. No network needed — skills are vendored in this repo.
#
# Usage:
#   bash install-deps.sh --dir <project-root>   # install PROJECT-LOCAL into <root>/.claude/skills
#   bash install-deps.sh --dir <root> --check   # dry run: report what's missing, install nothing
#   bash install-deps.sh --global               # install into the user's global ~/.claude/skills
#
# By DEFAULT skills install PROJECT-LOCAL so a build never pollutes the user's
# global ~/.claude/skills. The agents load these by name and DEGRADE GRACEFULLY
# to this skill's references/*.md if a skill is missing — so a run never hard-fails.
# Precedence: CLAUDE_SKILLS_DIR > --global > --dir <p>/.claude/skills > ./.claude/skills
# Requires: nothing but coreutils (skills are copied from vendor/).

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
  echo "ERROR: vendored GodotPrompter not found at $VENDOR_SKILLS" >&2
  echo "Re-clone it: git clone --depth 1 https://github.com/jame581/GodotPrompter into vendor/godot-prompter" >&2
  exit 1
fi

installed=(); skipped=()
for skill_path in "$VENDOR_SKILLS"/*/; do
  name="$(basename "$skill_path")"
  [ -f "$skill_path/SKILL.md" ] || continue
  if [ -e "$SKILLS_DIR/$name/SKILL.md" ]; then
    skipped+=("$name")
  elif [ "$CHECK" = "1" ]; then
    installed+=("$name (would install)")
  else
    cp -r "$skill_path" "$SKILLS_DIR/$name"
    installed+=("$name")
  fi
done

echo "GodotPrompter skills target: $SKILLS_DIR"
echo "  installed: ${#installed[@]}${installed[*]:+ — ${installed[*]}}"
echo "  skipped (already present): ${#skipped[@]}"
[ "$CHECK" = "1" ] && echo "(--check: nothing was written)"
echo "Done. Agents load these by name; if any is missing they degrade to references/*.md."
