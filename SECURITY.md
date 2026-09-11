# Security

agent-lock checks configuration files before launching a coding agent. It runs with your user permissions and stores its records in `~/.agent-lock/`.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/speedydevv1/agent-lock/security/advisories/new) when available. Include the version, platform, and a minimal reproduction. Do not post exploit details or credentials in a public issue.

## What the gate checks

- Configuration files, referenced local scripts, and installed Claude plugin hook definitions and their literal script references.
- Repository settings above a nested working directory, up to its repository root.
- Semantic configuration changes, including argument order, new keys, permission grants, and removed configuration files. Reordering object keys or permission lists is ignored. Ordinary document edits remain minor changes.
- Symlink targets for individual files inside the checkout. Links that escape the checkout, directory symlinks, and non-regular files are refused. Home inventory also covers installed plugins outside the home directory.

Scans refuse when the file count or directory depth limit is exceeded. Binary files and files larger than the text limit are hashed but cannot be reviewed as text. The current limits are in `lib/inventory.mjs`.

Launch flags that select another directory, worktree, or extra settings are refused. Change into the target folder first. An intentional exception can use `AGENT_LOCK_SKIP=1`, which is logged.

Only Claude has a safe-mode option. Codex and Gemini do not have a verified equivalent that excludes all project configuration.

Windows batch launchers refuse arguments containing percent signs because `cmd.exe` can expand them as environment variables. Use a native executable or pass that text on stdin.

## Secrets and model review

Dotenv files, including `.env.*` and dotenv files referenced by commands or symlinks, retain their key names and a hash. Their values are never copied into snapshots, reports, or model input. A content change requires approval.

Other configuration files can contain tokens, URLs with credentials, or secrets in commands. Their text may appear in local snapshots, reports, and optional model reviews. **Inspect these files before sharing a report or asking a model to review them.** State files use private permissions on POSIX; Windows relies on the user profile's ACLs.

Model review sends configuration text to the selected provider. Claude runs with restricted tools and hooks disabled. Codex runs with user configuration ignored and a read-only sandbox; read-only does not mean it has no tools or cannot read other files. Gemini review is disabled because its user settings cannot be isolated.

A model's answer never approves files. Prompt injection can still influence that answer.

## Limits

- The first approval records what exists. It cannot establish that the content is trustworthy.
- Programs running as your user can change the records, binaries, or bypass environment variables.
- IDE integrations, direct executable paths, and other launchers can bypass the installed shims. The Claude plugin's session-start warning cannot prevent startup execution.
- Shell path discovery is static. Computed paths, indirect script imports, dependency code, and arbitrary shell expansion are not completely covered. External checkout command targets are flagged but not pinned.
- Files can change after the final check and before the agent reads them. This is a launch guard, not a filesystem sandbox or continuous monitor.
- A model's flags and sandbox behavior depend on the installed CLI version. Refused flags should be treated as a failed review.

## Verify a checkout

```sh
shasum -a 256 -c SHA256SUMS
npm ci --ignore-scripts
npm run check
npm test
npm audit
```

`SHA256SUMS` detects accidental changes to the listed runtime files. It is not an authenticity signature: an attacker who changes both a file and its checksum can make the check pass.

CI checks the runtime hashes, dependencies, and Git history for recognized secret patterns. Passing these checks does not prove a repository is free of vulnerabilities.
