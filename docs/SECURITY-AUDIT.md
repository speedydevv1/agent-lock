# Security sweep — 2026-09-11

Reviewed baseline: `250e96d`. The accompanying changes contain the remediations described below.

**Result:** no credentials were detected in the source tree or available Git history. The npm audit reported zero known vulnerabilities. Manual review found exploitable change-detection gaps and unsafe handling of untrusted configuration; the accompanying changes fix the findings described below.

This is a source review and regression test pass, not a certification that every agent version or configuration is safe.

## Findings fixed

| Severity | Finding | Remediation |
|---|---|---|
| High | Reordered arguments, dotted JSON keys, and comma-brace sequences inside strings could produce misleadingly identical semantic comparisons. | Preserve JSON string content, distinguish literal keys from nested paths, and preserve argument order and duplicates. |
| High | Deleted configuration, existing dotenv value changes, scoped permission grants, and unknown execution settings could be silently accepted. | Treat configuration changes and removals as requiring approval. Keep only object-key and permission-list reordering exempt. |
| High | TOML prototype keys could modify `Object.prototype` while reading repository configuration. | Reject prototype-related keys at every table and assignment boundary. |
| High | Launching in an empty subfolder, using directory symlinks, or exceeding traversal limits could leave relevant configuration unchecked. | Check ancestor configuration and refuse layouts or limits that cannot be completely inventoried. Refuse alternate-directory and extra-config launch flags unless explicitly bypassed. |
| High | Dotenv files reached through command references or aliases could be treated as ordinary script text and copied to snapshots or model input. | Detect dotenv paths independently of file kind, remove raw dotenv text from entries, and retain only keys and hashes. |
| Medium | Plugin-derived snapshot labels could escape the intended snapshot directory. | Use digest filenames and constrain legacy snapshot reads to the snapshot directory. |
| Medium | Model-review paths did not all apply the launcher's Windows argument guard or the same directory-isolation checks. Gemini could load user hooks during review. | Centralize batch argument refusal, apply canonical path checks to both review commands, and disable Gemini review. Remove Codex's unverified safe mode. |
| Medium | Script paths inserted into generated shell scripts could be interpreted as shell syntax. Windows policy lookup used a bare executable name. | Quote installed POSIX paths literally, use an absolute registry executable, clear Windows `NODE_OPTIONS`, and harden generated batch launchers. |
| Medium | Repository-controlled terminal escapes and log newlines could disguise displayed changes or forge log entries. | Render terminal control bytes visibly and encode individual log fields. |
| Medium | Installed plugin script changes and paths containing spaces could be missed. | Track installed hook definitions and literal plugin script references, retain install metadata, and expand supported variables after tokenization. |
| Low | Hashing and snapshotting used separate file reads; files could also change during a long review. | Hash and snapshot the same read, then recheck approved configuration before normal launch. A final check-to-use race remains. |

Regression cases are in `test/security.test.mjs`, with launcher checks in the existing platform test files. Reproductions use temporary fixtures and harmless canaries.

## Repository and release hygiene

- No runtime npm dependencies. The development dependency is pinned; its audit returned zero advisories.
- Gitleaks v8.30.1 found no recognized secrets in the working directory, all locally available refs/history, or commit messages. There are 36 reachable commits; the Git diff scanner processed 35 commits. Scanner coverage is pattern-based and cannot rule out every secret format.
- Git author/committer metadata includes a personal Gmail address and historical account names. This is a privacy choice, not a credential. Source metadata also intentionally identifies the author. No history was rewritten.
- The npm package dry run contains 30 intended runtime, skill, plugin, license, and documentation files. It contains no test fixtures, local state, dependency installation, or audit artifacts.
- Credential files and local state now have ignore rules. Ignore rules do not remove already committed data.
- CI now pins GitHub Actions to full commit hashes, gives the token read-only contents permission, does not persist checkout credentials, disables npm install scripts, audits npm dependencies, and scans Git history for secrets. Dependabot update configuration was added. These measures follow [GitHub's workflow security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
- The minimum Node.js version is now 22. The README gives short CLI and skill installation instructions; the skill command was checked against the [official skills CLI documentation](https://github.com/vercel-labs/skills#install-a-skill).

## Initial local validation

- Full local test suite: 55 tests; 51 passed and 4 Windows-only tests skipped on macOS, Node v24.18.0.
- `npm run check`: passed.
- `shasum -a 256 -c SHA256SUMS`: passed.
- `actionlint .github/workflows/ci.yml`: passed.
- `git diff --check`: passed.
- `npm audit`: zero known vulnerabilities.
- Gitleaks history, commit-message, and working-tree scans: no leaks detected.
- `npm pack --dry-run --json`: reviewed; expected 30 files.

At the initial local audit, Linux, Windows, Alpine, Node 22, and the Windows install/uninstall integration had not yet run. The accompanying pull request must pass the configured CI matrix before merging. No real model was invoked for the audit; checker behavior was tested with stand-in executables.

## Remaining release actions

The GitHub API reports that the repository is **already public**. At the time of this sweep:

| Repository control | State |
|---|---|
| Secret scanning | Disabled |
| Secret push protection | Disabled |
| Dependabot security updates | Disabled |
| Private vulnerability reporting | Disabled |
| Protection on `main` | Not configured |

Enable the relevant controls in repository settings. Set required CI checks before enforcing branch protection, so the names match the new workflow. The maintainer confirmed the existing personal email for new commits; history is retained.

Merge the remediations after the full platform matrix passes, then publish an updated version. The existing `v0.0.1` tag predates this audit and does not include these fixes.

## Limits that remain

The gate runs as the same user as the agent. It cannot prevent that user or another process with the same permissions from changing its state or bypassing the launchers. Static path extraction does not execute or fully interpret shell programs, follow every dependency import, or monitor every file continuously.

The reviewer receives configuration text, which may contain credentials outside dotenv files. Codex's read-only sandbox can still read files; it is not a no-tools execution mode. Model input is bounded and may be truncated. A malicious instruction can influence a model's answer, which remains advisory and never records approval automatically.

See `SECURITY.md` for the operational coverage and threat model. A matching checksum file verifies consistency, not publisher authenticity.
