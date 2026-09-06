# Fork provenance

## Current candidate

- Repository: `ivanhxlabs/pi-subagents`
- Upstream: `Tintinweb/pi-subagents`
- Upstream base: `e955e29c51b7a6cce37e1108cd2d6c57a77e151c`
- Upstream version base: `v0.19.0` (`4f572eaa04c09d3dbc16e4a5f13a16b295e84e14`)
- Downstream branch: `wayfinder/strict-route-launch-157`
- Downstream patch range: `e955e29c51b7a6cce37e1108cd2d6c57a77e151c..HEAD`; the release ticket records the immutable tip
- Release tag: not assigned; release is outside implementation ticket 157

The fork retains Tintinweb's MIT license and copyright notice. Mutable pull-request branches are not trusted; every adoption below is pinned to the reviewed immutable head from the 2026-09-06 snapshot recorded by [ivanhxlabs/skills#156](https://github.com/ivanhxlabs/skills/issues/156).

## Adopted upstream work

| Upstream PR | Reviewed head | Status in candidate | Downstream scope |
| --- | --- | --- | --- |
| [#268](https://github.com/tintinweb/pi-subagents/pull/268) — thanks [@HerbertGao](https://github.com/HerbertGao) | `95d10867f391636e6563e3885e972618083f306b` | Merged as submitted | Preserve changed worktrees and report recovery paths on cleanup failure. Patch ID: `8279d1ed1fac2992452c225e53b46a6e8377bbdb`. |
| [#271](https://github.com/tintinweb/pi-subagents/pull/271) — thanks [@ChakornK](https://github.com/ChakornK) | `73cb25abca45fa0daab4831c4a2ad1d35d2775bb` | Merged as submitted, with trailing whitespace removed | Cache conversation rendering and retain its correctness/performance invariant tests. |
| [#221](https://github.com/tintinweb/pi-subagents/pull/221) — thanks [@dathtd119](https://github.com/dathtd119) | `316ecdb0a102ab883d004e0c36fc7a2adeacd334` | Merged as submitted, adapted around current runner code | Treat a clean final turn with no text and no tool use as failure; preserve the `toolUse` exemption. |
| [#290](https://github.com/tintinweb/pi-subagents/pull/290) — thanks [@amaksoft](https://github.com/amaksoft) | `5061f612b235031c98dc4205d614e6b57fc85d46` | Adapted | Strict attempts use monotonic cancellation evidence, pre-aborted signal handling, terminal settlement guards, and no route advancement after cancellation. Legacy resume redesign is not imported. |
| [#270](https://github.com/tintinweb/pi-subagents/pull/270) — thanks [@Nachompiras](https://github.com/Nachompiras) | `0ce069465d41e61cbc120c1e23549944a3547d05` | Adapted | Invocation-local assistant-message, assistant-output-event, and tool-call-start counters plus exactly-once strict attempt settlement. Notification, scheduler, settings, and ordinary-agent changes are excluded. |
| [#223](https://github.com/tintinweb/pi-subagents/pull/223) — thanks [@SBOne-Kenobi](https://github.com/SBOne-Kenobi) | `80cee706a369d944b41d9c3858ef5b41079a4b5d` | Adapted | Strict role resolution uses an immutable registry built from the invoking session's cwd and settings, independent of the process-wide legacy registry. |
| [#198](https://github.com/tintinweb/pi-subagents/pull/198) — thanks [@xz-dev](https://github.com/xz-dev) | `7fce4d68060212542f030fbb98ed8497fc83f7de` | Adapted | Preserve the legacy OAuth resume regression and prove distinct fresh strict child sessions share the parent-owned credential runtime without copying credentials. |
| [#180](https://github.com/tintinweb/pi-subagents/pull/180) — thanks [@xz-dev](https://github.com/xz-dev) | `c135e761bcce5a1cfb18fd9de1e8188922ce27c6` | Adapted | Bounded credential-redacted diagnostics and typed pre/post-execution strict failure boundaries. The PR's legacy retry/recovery policy is excluded. |
| [#279](https://github.com/tintinweb/pi-subagents/pull/279) — thanks [@tobymao](https://github.com/tobymao) | `10978165931565ada9490a768e921ae8b02a68f7` | Adapted | Git installs load committed `dist/index.js` output generated with lockfile-pinned TypeScript tooling; install-time compilation and the unpinned `npx` fallback are excluded. |
| [#154](https://github.com/tintinweb/pi-subagents/pull/154) — thanks [@xz-dev](https://github.com/xz-dev) | `619d1ea79f9f49e54ce0d89a6fe9400a7943bd46` | Adapted for the new surface | Strict diagnostics strip terminal controls, redact credentials, and are bounded before reaching progress or journal records. The unrelated viewer dependency and rewrite are excluded. |

## Reviewed work not included

- [#266](https://github.com/tintinweb/pi-subagents/pull/266) at `bd25d4ffff1a6b332268caefde8b73d20a7e2246` was removed after adversarial validation found that compare-and-unlink stale reclamation can delete a replacement lock. A `proper-lockfile` adaptation retained the same pathname reclamation race. Schedule locking is unrelated to strict routing and remains at the pinned upstream-base behavior until a separate owner-aware design is validated.

## Original downstream work

The fork adds the versioned workflow-only `strictAgent()` contract accepted in [ivanhxlabs/skills#153](https://github.com/ivanhxlabs/skills/issues/153): exact case-sensitive routes, runtime-owned serial fallback, fresh attempts, final-preflight model and effort enforcement, typed failures, explicit execution evidence, structured-output composition, per-attempt progress/journaling, and non-replayable strict receipts. Ordinary `agent()`, direct `Agent`, tolerant model resolution, and existing workflow replay remain on their previous paths.

## Implementation validation

Validated from the unstaged candidate checkout:

- Pi 0.85.0: lint and typecheck passed; 110 test files passed, with 2,234 tests passed and 7 live-provider tests skipped.
- Pi 0.85.1: lint and typecheck passed; 110 test files passed, with 2,234 tests passed and 7 live-provider tests skipped.
- `npm run test:e2e`: 15 files passed, with 72 deterministic tests passed and 7 live-provider tests skipped.
- `npm run build` and direct import of `dist/index.js`: passed.
- Production-only offline install simulation: passed with the committed `dist/index.js` entry present.
- `npm pack --dry-run --ignore-scripts`: 193 packaged files, including `dist/index.js` and excluding tests and `AGENTS.md`.
- `npm run bench:ab -- e955e29c51b7a6cce37e1108cd2d6c57a77e151c`: completed three rounds; cached conversation rendering improved 91.7%–99.6% in the measured warm-render cases, while unrelated measured rows stayed within approximately ±3.4%.
- `git diff --check`: passed.
- Mutation checks proved the zero-tool-start fallback gate, strict non-replay boundary, and final-preflight model mismatch tests fail when their enforcement is broken; all source mutations were restored.
- A source-only adversarial finding invalidated the planned #266 adoption, so that patch and its attempted lock-library adaptation were removed rather than shipped.

No live provider request was made. Release-owned immutable commit, tag signature, CI URLs, installed-environment evidence, upgrade/rollback evidence, and final downstream commit mappings remain pending. They are recorded only after Ivan creates the candidate commit and the release workflow validates that exact commit.
