# Retained comparison manifest, version 1

`comparison.mjs` accepts a narrow legacy key-transition replay receipt and an
AgentVerify receipt. Both must have actual matching speed checks. It does not
accept an arbitrary summary claiming that two runs matched.

Every file reference is `{path,bytes,sha256}`. Paths are contained relative files,
with no traversal or symlinks. The manifest has:

- `schema_version: 1`, `baseline_revision`, `adapter_parent_revision` and
  `adapter_revision`: full Git object IDs. The adapter parent is the baseline.
- `adapter_delta`: the retained binary-capable Git diff from baseline to the
  adapter revision, reviewed for adapter-only scope.
- `old` and `new`: each has file bindings `source`, `config`, `build_request`,
  `build_lifecycle`, `build_identity`, `launch_request`, `lifecycle`, `request`
  and `receipt`. `source` is the launcher's source identity for that revision.
  Configuration paths are absolute native-host paths. Game and build requests
  must bind that same project/source root. `request_argument` is the exact
  engine argument containing the scenario path; those file bytes must still
  match the retained scenario.
- `old.trace`: the legacy raw CSV with `phase` and finite `speed` columns.
- `new.plugin_source`: contained directory holding the exact copied AgentVerify
  source. `new.artifacts` contains artifact bindings plus `receipt_path` for any
  new receipt artifacts. `new.initialization` binds JSON containing the observed
  `requested_start`, `ground_hit: true`, and `teleports: 1`.
- `checks`: the complete list of `{phase,old_metric,new_metric,new_check}`.
  Supported old names are `max_speed` and `end_speed`; corresponding new checks
  use metric `speed` with aggregation `max` and `last`. Bounds and durations
  must match; extra or omitted phases/checks fail.

Legacy requests contain `start`, and phases with `name`, `seconds`, optional
`keys`, and `expect` metric ranges. Analog, tap, console and screenshot scenarios
are intentionally outside this comparison adapter. The final phase releases all
keys. The old receipt contains `phases[].checks[]` (`metric`, `value`, `pass`),
`checks_run`, `checks_failed`, `replay_actions`, environment and validated save
isolation fields. Its raw action count must equal phase-start key transitions
plus one initialization teleport. AgentVerify's count covers declared actions;
its cleanup release records are distinct.

The verifier checks actual build products on the native host and recomputes old
checks from the CSV within its 0.1-unit serialization precision. New observations
use the existing AgentVerify validator. A malformed manifest, failed lifecycle,
missing artifacts, zero checks or mismatched verdict cannot qualify A6.

These checks establish consistency of retained evidence, not attestation of a
hostile producer. Review the retained adapter diff and initialization against the
baseline source; a caller-provided parent ID is not independently authenticated
Git history. Keep private consumer identities and local paths in private evidence.
