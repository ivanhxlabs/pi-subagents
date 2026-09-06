# Fork provenance

## Release identity

- Repository: `ivanhxlabs/pi-subagents`
- Retained manifest name: `@tintinweb/pi-subagents`
- Distribution: GitHub releases and Git package installs; this fork is not published to npm
- Upstream: `Tintinweb/pi-subagents`
- Upstream version base: `v0.19.0` (`4f572eaa04c09d3dbc16e4a5f13a16b295e84e14`)
- Upstream base commit: `e955e29c51b7a6cce37e1108cd2d6c57a77e151c`
- Downstream implementation commit: `7051273e6ada821c7fa858281cb2d78a3ef50763`
- Downstream implementation merge: `aba7a290fab9ade32fa213911d8783564c797747`
- Downstream implementation pull request: [ivanhxlabs/pi-subagents#1](https://github.com/ivanhxlabs/pi-subagents/pull/1)
- Release version and immutable annotated tag: `v0.19.0-ivanhxlabs.1`
- Downstream patch range: `e955e29c51b7a6cce37e1108cd2d6c57a77e151c..v0.19.0-ivanhxlabs.1`
- Release approver and signer: Ivan E. Hernandez T. (`iamivanhx`), SSH signing-key fingerprint `SHA256:LMOB/u3v1AvMdfmD0tlhHT6aWScgdek2cv4aF5w/1As`
- Trusted release key: `docs/release-signers`
- Update channel: mutable `latest`, promoted only after the immutable tag passes `.github/workflows/promote-release.yml`

The signed annotated release tag is the authoritative pointer to the exact release commit. The promotion workflow verifies it against the committed Ivan-owned release key as well as GitHub's signature verification. The mutable `latest` tag is only an update channel and is never provenance by itself.

The fork retains Tintinweb's MIT license and copyright notice. Mutable pull-request branches are not trusted; every adoption below is pinned to the reviewed immutable head from the 2026-09-06 snapshot recorded by [ivanhxlabs/skills#156](https://github.com/ivanhxlabs/skills/issues/156).

## Upstream-base work after `v0.19.0`

- `e955e29c51b7a6cce37e1108cd2d6c57a77e151c` — Tintinweb's [#283](https://github.com/tintinweb/pi-subagents/issues/283) fix adds exact lowercase `workflow` collision detection so the built-in workflow surface stands down when `@quintinshaw/pi-dynamic-workflows` is active.

## Adopted upstream work

All downstream adaptations listed here landed in `7051273e6ada821c7fa858281cb2d78a3ef50763`.

| Upstream PR | Reviewed head | Status in release | Downstream scope |
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

The fork adds the versioned workflow-only `strictAgent()` contract accepted in [ivanhxlabs/skills#153](https://github.com/ivanhxlabs/skills/issues/153): exact case-sensitive routes, runtime-owned serial fallback, fresh attempts, final-preflight model and effort enforcement, typed failures, explicit execution evidence, structured-output composition, per-attempt progress and journaling, and non-replayable strict receipts. Ordinary `agent()`, direct `Agent`, tolerant model resolution, and existing workflow replay remain on their previous paths.

## Integration evidence

- [ivanhxlabs/skills#158](https://github.com/ivanhxlabs/skills/issues/158) records the package-owned `hx-schema-lanes` integration against implementation commit `7051273e6ada821c7fa858281cb2d78a3ef50763`.
- [ivanhxlabs/skills#160](https://github.com/ivanhxlabs/skills/pull/160) merged as `aeb3e359e2622226e88a446f50f65db27e857e7d` after its 45-test targeted harness, 100-test repository suite, typecheck, and CI run passed.

## Validation evidence

- [GitHub Actions run 34030715583](https://github.com/ivanhxlabs/pi-subagents/actions/runs/34030715583) passed the build and compatibility jobs for Pi 0.85.0, Pi 0.85.1, and the then-current latest Pi release at implementation commit `7051273e6ada821c7fa858281cb2d78a3ef50763`.
- At that implementation commit, Pi 0.85.0 and 0.85.1 each passed lint, typecheck, 110 test files, 2,234 tests, and the deterministic E2E suite of 15 files and 72 tests; 7 live-provider tests were skipped.
- Build, committed-build freshness, compiled import, production-only offline installation, package dry-run, and `git diff --check` passed.
- Three viewer benchmark rounds reproduced the reviewed warm-render improvement. Mutation checks proved the zero-tool-start fallback gate, strict non-replay boundary, and final-preflight model mismatch assertions fail when their enforcement is removed.
- `.github/workflows/promote-release.yml` revalidates the immutable tag against Ivan's committed trusted release key and GitHub's signature verification, then checks package version, release object, default-branch ancestry, full check suite, deterministic E2E suite, committed build including untracked outputs, and an exact-tag installation under Pi 0.85.1 before it moves `latest`. A serialized ancestry guard prevents an older release from moving `latest` backward.

No credentials or live-provider output belong in this ledger. Release-signature, promotion-run, active-installation, and minimal live-invocation evidence are linked from the GitHub Release and the sanitized installed-state receipt in `ivanhxlabs/skills`.
