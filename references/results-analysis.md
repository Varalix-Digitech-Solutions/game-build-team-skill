# Results analysis — the consistent way game-build-team reports a run

This is the canonical reference for **how a run's outcome is measured, recorded, and
reported**. Before this layer, the engine produced rich structured gate verdicts that
lived only in the Workflow's in-memory return and vanished when the session ended.
Now every run leaves a durable, machine-readable record plus a human report — built
from the same verdict schemas the two gates already enforce.

Three scripts do the work, and they deliberately read like one toolkit:

| Script | Owns | Analogy |
|---|---|---|
| `scripts/state.mjs` | **Lifecycle** — phase, which features are done / tested / built / pending / flagged, resume reconciliation | "where are we" |
| `scripts/report.mjs` | **Outcome** — per-feature, per-round, per-GATE verdicts + issue counts + the screenshot that proves it + final scorecard | "how did it turn out" |
| `scripts/godot_verify.sh` | **Evidence** — runs the headless suite and captures the frame the gates judge | "the gate's hands" |

The Workflow runtime **cannot write files** (no `fs`, no clock). So persistence
always goes through a Node CLI invoked by an agent or the Manager — the Tester (test
gate), the Creative Director (creative gate), and the Manager (on completion) call
`report.mjs` over Bash. That's why the record survives a crash or usage-limit cutoff
mid-run: each gate verdict is written the moment it's reached, not at the end.

## Two gates, recorded separately

A feature only counts as **done** when it passes BOTH gates, so the report tracks
them separately — you can see exactly *where* a feature struggled:

- **`gate=test`** — correctness (Tester): suite green + screenshot vs the design
  contract + invariants intact.
- **`gate=creative`** — fun (Creative Director): readable / responsive / satisfying /
  on-theme / fair.

Derived feature status mirrors `state.mjs`: an `OK` on the test gate → `tested`; an
`OK` on the creative gate → `done`; an `NG` keeps it `building`; the Manager can force
`flagged` (round cap hit) via `--feature-status`.

## The lifecycle (per run)

```bash
# Preflight — initialise both records side by side
node scripts/state.mjs  init --dir <proj> --goal "<goal>"
node scripts/report.mjs init --dir <proj> --goal "<goal>" --target "<game>" --run-id <wf id>

# During the loop — the gate agents call this every round (OK or NG)
node scripts/report.mjs append-round --dir <proj> --feature "<name>" --round <N> \
  --gate test     --verdict <OK|NG> --issues-json '<[]>' [--screenshot <relpath>]
node scripts/report.mjs append-round --dir <proj> --feature "<name>" --round <N> \
  --gate creative --verdict <OK|NG> --issues-json '<[]>'

# Completion — the Manager finalizes and renders the scorecard
node scripts/report.mjs finalize --dir <proj> --final-verdict <OK|NG> [--drift-json '<[]>']
node scripts/report.mjs render   --dir <proj>     # writes .game-build-team/report.html
```

## Why JSON-then-render

`report.json` is the source of truth; `report.html` is a disposable, self-contained
human "receipt" (no external CSS/JS) regenerated on demand with `report.mjs render`.
The scorecard shows, per feature: status, total rounds, the **test-gate trend**, the
**creative-gate trend**, a link to the last captured frame, and blocker/major/minor
issue counts — plus an outstanding-issues section (each feature's last-round issues)
and any drift flags. It makes "done means verified AND fun" auditable at a glance.

## Both records live under `.game-build-team/`

`state.json`, `report.json`, and `report.html` all sit in the project's
`.game-build-team/` dir (gitignored in the skill repo; runtime artifacts of the
*target* project, never part of the skill). Delete the dir to start clean; keep it to
resume and to audit how the run turned out.
