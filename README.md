# agent-lock

**Get asked again when the files your coding agent trusts change.**

Agent settings can run shell commands, load plugins, and connect to external servers. A trusted folder can gain new settings after a `git pull`.

agent-lock records the files you approve. Before Claude Code, Codex, or Gemini starts, it checks them again. If a setting that configures the agent changes, it stops and shows you what changed.

Free. Open source. No runtime dependencies. Works on macOS, Linux, and Windows.

## Install

You need [Node.js](https://nodejs.org/) 22 or newer and Git.

Run these commands in your terminal. On Windows, use PowerShell:

```sh
git clone https://github.com/speedydevv1/agent-lock "$HOME/agent-lock"
node "$HOME/agent-lock/agent-lock.mjs" install
```

Open a new terminal, then review the folders your agents already trust:

```sh
agent-lock scan
```

The installer adds launch checks for `claude`, `codex`, and `gemini`, plus Git hooks that warn when settings change. You choose which files to approve.

## Get the skill

The skill helps your coding agent explain agent-lock warnings and inspect changes.

```sh
npx skills add speedydevv1/agent-lock --skill agent-lock --copy
```

Choose your agent when prompted. Install the CLI above to get the launch checks.

[Read the skill](skills/agent-lock/SKILL.md) · [Skills installer](https://github.com/vercel-labs/skills)

## Use it

Start your agent as usual:

```sh
claude
# or: codex
# or: gemini
```

Unchanged settings let it start. Changed settings open a review prompt. You can inspect the files, ask a model to review them, approve the changes, or quit.

| Command | What it does |
|---|---|
| `agent-lock seal` | Review and approve this folder for the first time. |
| `agent-lock diff` | Show what changed. |
| `agent-lock approve` | Review and approve the new files. |
| `agent-lock check` | Ask Claude to review the files from a temporary folder. |
| `agent-lock check --codex` | Ask Codex instead. |
| `agent-lock diff home` | Check your user settings. |
| `agent-lock status` | List the folders you approved. |
| `agent-lock uninstall` | Remove the launch checks and Git integration. |

## Extra protection for Claude Code

The optional plugin checks for settings changes during a session. It also includes the skill.

```sh
claude plugin marketplace add speedydevv1/agent-lock
claude plugin install agent-lock@agent-lock
```

Keep the CLI installed: its launch check runs before project hooks can start.

## What it checks

Agent configuration in `.claude`, `.codex`, and `.gemini`; nearby VS Code, Cursor, and dev container settings; user settings; and local scripts referenced by commands.

It also records instruction files such as `CLAUDE.md` and `AGENTS.md`. Ordinary documentation edits do not block a launch. `.env` values are hashed but never copied into snapshots or sent to the reviewer.

## Know the limits

- **Approval is yours.** A matching fingerprint means the files match what you approved. It does not prove they are safe.
- **Launch through the terminal.** IDE extensions and commands that bypass the installed launchers can bypass the check.
- **Model review is optional.** It sends configuration text to the selected model. Other configuration files can contain credentials; review their contents before using this feature. Gemini review is disabled because its user settings cannot be isolated.
- **This is a local guard.** Programs running as your user can change its records. It does not sandbox your agent or inspect every dependency.

Records stay in `~/.agent-lock/`. Uninstall keeps them so you can review past approvals.

See [SECURITY.md](SECURITY.md) for coverage limits and vulnerability reporting.

[MIT license](LICENSE)
