# Testing in dev mode

- Run the affected tests while editing; run `node scripts/check.mjs` before pushing or merging. This dependency-free local command owns the merge checks and is also used by CI.
- Keep CI as one non-required Linux observer per ready pull request. Do not add a post-merge branch run, install browsers/engines, or add an OS matrix to the pull-request path. Revisit this policy when the owner moves the project out of dev mode.
- Before adding tests, find the existing owner of the invariant and extend it. Cover behavior at public, filesystem and lifecycle boundaries; avoid checks that only mirror implementation.
- Add compatibility coverage only for an identified consumer obligation. Current invalid/missing-input behavior still needs coverage where it protects users.
- Use unique temporary directories and dynamic ports; derive checkout paths from the file location. Do not write under the user's home directory or read `.git` directly in tests.
- Keep browser/GPU and native-engine sample acceptance separate from the dependency-free merge lane; use the documented engine setup for those checks.
- Keep plugin content free of language about our own machines and non-plugin projects; that belongs in the wiki. `scripts/release-consistency.test.mjs` fails on home-directory paths, GPU model names, links into non-plugin repositories and wiki paths. To also check private project names without listing them in the repo, set `AGENT_UNREAL_PRIVATE_TERMS_FILE` to a local file with one term per line.
