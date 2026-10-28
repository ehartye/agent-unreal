# Scripts

Dependency-free Node (20.11 or newer) used by the merge gate and by authors. `node scripts/check.mjs` is the one command to run before pushing; the pieces below are what it runs.

| File | What it does |
| --- | --- |
| `check.mjs` | The gate: the Node tests, a lint per skill folder, the listing report, then the invisible-Unicode scan. Options below. |
| `lint-skills.mjs` | The per-skill lint (frontmatter, sizes, selector table, links, placeholders, evidence labels). |
| `scan-unicode.mjs` | Invisible Unicode in every tracked and untracked text file. |
| `skill-citations.mjs` | The citation check described below; `sibling-skills.json` is its names-only snapshot. |
| `release-consistency.test.mjs` | Manifest, README and hygiene checks, and the citation test. |
| `pin-engine.mjs` | Writes the engine pin (`engine-version.json`) from an installed engine; a dry run unless `--write`. |
| `engine-version-pin.test.mjs` | Validates the pin file and scans the skills, READMEs and docs for version strings outside `engine-version-allowlist.json`. |

## The gate

- `node scripts/check.mjs` runs everything. `--no-tests` runs the lints and the scan only.
- `--skill <name>` lints only those skills with the gate's flags. `--file <name>` shows only the findings in that file (a reference's name, with or without `.md`, or `SKILL.md`) from the skills that have it. Both skip the tests and the Unicode scan.
- `--allow-orphan <file>` hides the orphan finding for a new reference until its selector row exists. It names a reference of a selected skill, or the run stops with exit code 2.
- `--labels-since <ref>` sets the base for the diff-aware label rule. The rule applies to `unreal-effects` and `unreal-rendering`, whose old bullets are still accepted with any text: a bullet added or changed since the base must carry a real `[tested]`, `[documented]` or `[general]` label. The default base is the merge base of `HEAD` with `origin/main`, else `main`; a checkout with neither (a shallow clone) keeps the any-text rule and says so on stderr. The rule reuses the lint's own claim detection, so the exempt headings (Links, Related, See also, Sources, Not covered here), code fences and link-only bullets are the same ones the label rule skips.
- `[tested]` means checked in this repo: a run here, or for the repo's own scripts a node test (the line says so); it is a record of what was seen, not a promise about every build, and nothing obliges a rerun when the engine changes. `[documented]` is Epic documentation or engine source; `[general]` is judgement or an observation not reproduced here.
- The lint also checks: the listing length (`description` + ` - ` + `when_to_use`, warning from 1,400 characters, failure over 1,536), that `when_to_use` starts with "Use when", that frontmatter is strict YAML (an unquoted value with a colon and a space fails; double-quote it), and that no `$1` or `$ARGUMENTS` placeholder is left in a skill. `SKILL.md` is checked everywhere, code fences included, because the host substitutes text. In a reference only `$ARGUMENTS` is rejected inside code; `$1` is rejected in prose and allowed in code, because shell and regex examples use it. Sizes count bytes with line endings normalised to LF.
- The listing report prints each skill's listing length and headroom, and warns when two skills share two or more trigger words that no third skill uses. It never fails the gate.

## Moving the engine pin

Plugin development tooling, not something a skill asks a user to run. `engine-version.json` at the repo root names the build the repo is worked on; it is informational. Nothing refuses to run on another build: a runner under `examples/unreal` prints a `NOTE: not the pinned build ...` line after the engine line and carries on. Moving to a new build takes no verification run and creates no rework: `[tested]` lines are records of what was seen, and a line is revisited only when work touches it.

1. Work on the new build as usual.
2. `node scripts/pin-engine.mjs --engine "<UE folder>"` prints the pin it would write; add `--write` to update the `unreal` block (the `uefn` block is left alone). It reads the changelist from the editor executable and refuses to guess a version when `Build.version` is stale after a launcher update: pass `--version X.Y.Z` then.
3. The docs need no edit: they carry no patch version, and `engine-version-pin.test.mjs` keeps it that way.

## Invisible Unicode

`scan-unicode.mjs` rejects format characters (category Cf: zero-width, bidirectional, byte-order mark, soft hyphen), private-use (Co), unassigned (Cn) and the tag block U+E0000 to U+E007F, in any text file, `.mjs` and `.py` sources included. It prints `file:line:column`, the code point and the line with the character shown as `<U+XXXX>`. To write such a character in a test or fixture, build it with `String.fromCodePoint(0xFEFF)` instead of typing it or writing a `\u` escape through an editing tool, which can turn the escape into the literal character. Unassigned depends on the Unicode data of the running Node, so a very new character can be reported as unassigned by an older Node.

## Citing another plugin's skill

`skill-citations.mjs` reads `skills/**/*.md`, `examples/**/*.md` and `README.md` (fenced code is ignored) and checks every skill name it can bind to a plugin. `release-consistency.test.mjs` runs it against `sibling-skills.json`, so the check runs by default and needs no sibling checkout.

Write a citation in one of these forms; the name is lowercase and hyphenated, a list may use commas, `and` or `or`, and a name may span a line break:

| Form | Example |
| --- | --- |
| name `in` or `from` plugin | `` `engine-selection` in agent-engine `` |
| name, plugin in parentheses | `` `engine-asset-import` (agent-engine) `` |
| name `skill,` plugin | `` `phaser-verification` skill, agent-phaser `` |
| plugin's names `skills` | `` the `agent-tests` plugin's test-strategy and test-audit skills `` |
| `its` name `skill`, after the plugin in the same paragraph | `` agent-meshes ... (see its `mesh-build` skill) `` |
| `whose` name, after the plugin in the same paragraph | `` agent-meshes, whose `mesh-tool-selection` decides `` |
| name `skill` (backticked) | `` the `unreal-import` skill `` |

How a name resolves: a name bound to a plugin must be in that plugin's list (the snapshot, or the live checkout in sibling mode); `agent-unreal` resolves against `skills/`. A backticked `name skill` with no plugin resolves in this plugin first, then in the plugin named earlier in its paragraph, and otherwise fails; write `` `name` in <plugin> `` for another plugin's skill. A plugin the snapshot does not list fails. Bare hyphenated words beside the word "skill" are not read as names, and `its` or `whose` with no plugin earlier in the paragraph is not read as a citation.

What it cannot see:

- A skill that exists but no longer holds the cited content. A name check passed the stale pointer to `engine-phaser` after profiling moved to `phaser-verification`, because `engine-phaser` still exists (both skills now belong to agent-phaser). Re-read the target when its plugin releases a split.
- A citation written outside these forms, such as "use `x` from the other plugin" with no plugin name, or a name in a table cell with no plugin.
- A snapshot that has gone stale. `sibling-skills.json` is committed and names only (plugin to sorted skill names, no paths or versions).

Refresh and verify:

- `node scripts/skill-citations.mjs --write-snapshot <folder> [--plugins a,b,c] [--merge]` rewrites the snapshot from `<folder>/<plugin>/skills/*`, or from the newest `<folder>/<plugin>/<version>/skills/*` (the plugin cache layout). `--merge` keeps plugins not named.
- `AGENT_UNREAL_SIBLING_PLUGINS=<folder of sibling checkouts>` adds a live comparison to `node scripts/skill-citations.mjs` and to the citation test. A name the snapshot lists that the checkout lacks, and a name the checkout has that the snapshot lacks, both fail. A plugin folder that is absent is a note (not every machine has every sibling), and its entry is not verified. Citations are then resolved against the live names where they exist.

## Authoring guidance

- Cite an engine fact as an install-relative path with a symbol anchor, for example `Engine/Source/Runtime/RHI/Public/DynamicRHI.h` and the symbol name, never an absolute path and never a link into another repository. The hygiene test rejects home-directory paths in any file, output examples included.
- Find the path and symbol with the helper: `node examples/unreal/engine_source.mjs --engine "<UE folder>" <query>`, where the query is a console variable such as `r.MegaLights.Allowed`, a symbol, a module name or a file name. It prints `path:line` citations relative to the install. Read the printed line before citing a symbol hit; the rank is a reading of the hit's own line, not a parse. The helper needs the engine's source on disk and does not start the engine.
- Cite another plugin's skill in one of the forms above, so the check can see it.
- Keep Unreal and UEFN versions out of skills, references, READMEs and docs: the pin in `engine-version.json` is the one place, and the lint (`engine-version-pin.test.mjs`) fails otherwise. An allowlist entry in `scripts/engine-version-allowlist.json` needs a reason. The lint scans Markdown only, so code comments and test fixtures may name versions.
- Keep names of machines, games and other non-plugin projects out of plugin files; set `AGENT_UNREAL_PRIVATE_TERMS_FILE` to a local file to check private names. One term per line: a plain line matches literally and ignoring case, and `/pattern/flags` is a regular expression with exactly those flags (whole-word, case-sensitive matching for a name that is also an ordinary word). A line that is not a valid pattern fails the test and is reported by line number.
