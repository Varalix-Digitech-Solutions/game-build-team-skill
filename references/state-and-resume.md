# State & resume — first-class pause/resume/recovery

The user can stop and come back any time — including after a usage-limit cutoff in
a *different* session. Durability rests on `.game-build-team/state.json` plus the
Tester writing a `done` marker the moment a feature passes.

## state.json schema (managed via scripts/state.mjs — don't hand-edit)

```jsonc
{
  "version": 1,
  "goal": "…",
  "projectDir": "/abs/path/to/your/godot-project",
  "godotBin": "godot",
  "designRefs": "graphify-out",
  "runConfig": { "modelTier": "max-fidelity", "autonomy": "autonomous",
                 "maxRounds": 4, "finalCap": 3, "docsDepth": "none",
                 "waveSize": 0, "skipFinal": false },
  "paths": { "features": "docs/features", "verifyScript": "<abs>/scripts/godot_verify.sh",
             "statePath": "<abs>/scripts/state.mjs", "skillDir": "<abs skill dir>" },
  "phase": "setup|recon|build|done",
  "lastRunId": "wf_…",
  "features": [
    { "name": "Serve HUD pips", "specPath": "docs/features/serve-hud-pips.spec.md",
      "targetFiles": ["ui/detail_sheet.gd"], "complexity": "moderate",
      "status": "pending|spec|building|built|done|flagged", "rounds": 0 }
  ],
  "docs": { "status": "pending", "docPath": "docs/features/IMPACT.md" },
  "flagged": []
}
```

Status meanings: `pending` (not started) → `spec` (spec written) → `building`
→ `built` (files on disk, NOT yet Tester-approved) → `done` (Tester-approved,
durable) | `flagged` (hit round cap, needs Manager).

## CLI

```bash
node scripts/state.mjs init        --dir <proj> --goal "…" --godot godot
node scripts/state.mjs add-feature --dir <proj> --json '{"name":"…","targetFiles":["…"]}'
node scripts/state.mjs status      --dir <proj>
node scripts/state.mjs set-run     --dir <proj> --run-id wf_xxx
node scripts/state.mjs mark-feature --dir <proj> --name "…" --status done --rounds 2   # Tester does this on OK
node scripts/state.mjs reconcile   --dir <proj>   # before resume
node scripts/state.mjs remaining   --dir <proj>   # not-done features as JSON
```

## The durable contract

**The Tester marks a feature `done` the instant its verdict is OK** (it's the
only actor that can write to disk; the Workflow sandbox cannot). That marker is
what makes the run resumable — a crash or cutoff resumes without redoing approved
features.

## Resume

- **`/clone-status`-style check** — `node scripts/state.mjs status --dir <proj>`
  reports features done / in-flight / pending / flagged, phase, last run id.
- **Pause** — `TaskStop` the running Workflow. Nothing in-flight is lost; `done`
  features are on disk.
- **Resume**:
  1. `node scripts/state.mjs reconcile --dir <proj>` — syncs state↔disk in CODE
     (not Manager discretion): fills `specPath` from disk (don't re-spec), marks
     on-disk-but-unverified features `built` (Tester re-validates, not a blind
     rebuild), demotes `done`-without-file to `pending`, rebases a stale
     `projectDir`.
  2. Relaunch:
     - **same session** (after a pause/edit): Workflow with
       `resumeFromRunId: <lastRunId>` — unchanged `agent()` calls return cached
       results instantly; only new/edited work runs live.
     - **new session** (after a cutoff): the in-memory journal is gone — use the
       **durable path**: rebuild `args.features` from state (the engine skips
       `status:'done'` features and test-first re-validates `status:'built'`
       ones), launch fresh. Journal-independent and always safe; prefer it when
       in doubt.

If the user comes back and just says "continue", treat it as resume.
