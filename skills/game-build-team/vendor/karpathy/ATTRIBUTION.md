# Vendored: Karpathy Guidelines

The `karpathy-guidelines` skill is vendored verbatim from
**forrestchang/andrej-karpathy-skills**
(https://github.com/forrestchang/andrej-karpathy-skills), MIT License (declared
in the upstream README and the skill's frontmatter). The guidelines themselves
derive from Andrej Karpathy's publicly shared observations on LLM coding
pitfalls.

game-build-team's `install-deps.sh` installs it into the target project's
`.claude/skills/` alongside the GodotPrompter set, as part of the team's
code-quality bundle. We ship it here so a run works offline and is pinned to a
known-good version. Re-sync: re-fetch `skills/karpathy-guidelines/SKILL.md`
from upstream into this dir.

How the four guidelines compose with this skill's flow (the harmony mends) is
defined in `references/skills-loadout.md` — agents apply the guidelines AS
ADAPTED there, since workflow agents cannot ask the user mid-run and briefed
juice is requested scope.
