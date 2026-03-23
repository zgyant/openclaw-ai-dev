<div align="center">

#       🤖
#     🦞🦞🦞
#    🦞 🦞 🦞
#      🦞🦞
#     🦞  🦞
# OpenClaw — AI Dev Agent

</div>

This repo includes an **AI Dev Agent** built on top of OpenClaw: a fully automated coding agent that polls Jira for assigned tickets, implements the required changes using an LLM, and opens a Bitbucket pull request — all without manual intervention.

For general information about **OpenClaw** (gateway setup, channels, plugins, configuration, and more), visit the main repository:

https://github.com/openclaw/openclaw

---

## Quick Start — one command

```bash
curl -fsSL https://raw.githubusercontent.com/zgyant/openclaw-ai-dev/main/setup.sh | bash
```

That's all you need to type. Here's what happens:

1. `install.json` is downloaded to your current directory (a config template with every option documented inline)
2. The installer pauses and tells you to **edit `install.json`** — fill in your API key and any channels/plugins you want
3. Press **Y** in the terminal to continue — everything runs automatically from there

The installer:

- Installs `openclaw` globally via **pnpm** (or npm / git — your choice in the config)
- Runs `openclaw onboard --non-interactive` with your gateway and AI provider settings
- Adds any messaging channels you enabled (Telegram, Discord, Slack, Signal, Matrix)
- Installs and enables any plugins you listed
- Writes the AI Dev Agent config to `~/.openclaw/dev-agent-instances.json`

> **Security:** `install.json` contains your API keys. It is listed in `.gitignore` — never commit it.

### Already have install.json? Re-run the installer

```bash
bash easy-install.sh
```

The script is saved to your current directory on first run. Edit `install.json` any time and re-run to apply changes.

### install.json reference

Copy `scripts/install.template.json` → `install.json` and fill in the sections you need.
Every field has an inline `_doc` / `_hint` comment in the template explaining it.

**Minimum to get started:**

```jsonc
{
  "ai_provider": {
    "auth_choice": "openai-api-key",   // see template for all provider options
    "api_key": "sk-..."
  }
}
```

**Enable a channel** (e.g. Telegram):

```jsonc
{
  "channels": {
    "telegram": {
      "enabled": true,
      "bot_token": "1234567890:ABCdef...",
      "dm_policy": "pairing"
    }
  }
}
```

**Enable the AI Dev Agent:**

```jsonc
{
  "dev_agent": {
    "enabled": true,
    "name": "My Dev Agent",
    "jira": { "host": "https://yourorg.atlassian.net", "email": "you@co.com", "api_token": "..." },
    "bitbucket": { "username": "you", "app_password": "...", "workspace": "myws", "repo": "myrepo" }
  }
}
```

**Supported AI providers** (set `ai_provider.auth_choice`):

| Value | Provider |
| --- | --- |
| `openai-api-key` | OpenAI |
| `anthropic` | Anthropic Claude |
| `gemini-api-key` | Google Gemini |
| `mistral-api-key` | Mistral |
| `openrouter-api-key` | OpenRouter |
| `xai-api-key` | xAI / Grok |
| `github-copilot` | GitHub Copilot (OAuth) |
| `ollama` | Local Ollama (no key needed) |
| `custom-api-key` | Any OpenAI-compatible endpoint |
| `kilocode-api-key` | Kilocode |
| `opencode-zen` | OpenCode Zen |

**Install method** — set `install.method`:

| Value | Description |
| --- | --- |
| `pnpm` | `pnpm add -g openclaw` (default, recommended) |
| `npm` | `npm install -g openclaw` |
| `git` | Clone and build from source |

---

## AI Dev Agent

### How it works

```
Jira                       Dev Agent                     Bitbucket
─────                      ─────────                     ─────────
Tickets assigned to you ──► Poll on interval             Feature branch
                              │                           │
                              ▼                           │
                           Plan steps (LLM)               │
                              │                           │
                              ▼                           │
                           Write code (LLM)               │
                              │                           │
                              ▼                           │
                           Commit & push ─────────────────►  Open PR
                              │
                              ▼
                           Move ticket → "In Review"
```

**Per-poll cycle:**

1. Fetch Jira tickets: `assignee = currentUser() AND status in ("To Do", "Open", "Reopened", "Backlog")`.
2. For each ticket (up to `maxTickets`):
   - Move ticket to **In Progress**.
   - Run a planning LLM step to break the task into steps.
   - Run a coding LLM step to generate file changes.
   - Create a feature branch `feature/<TICKET-KEY>-...`.
   - Write files, commit, and push.
   - Open a Bitbucket PR titled `<TICKET-KEY>: <summary>`.
   - Move ticket to **In Review**.

---

### Configuration

Instances are persisted to `~/.openclaw/dev-agent-instances.json`.

Each instance stores a `params` object:

```jsonc
{
  "id": "abc123",
  "name": "Backend Agent",
  "status": "stopped",
  "createdAtMs": 1742900000000,
  "params": {
    "pollIntervalMs": 300000,

    // Agent behavior (Markdown, injected as system prompt)
    "behaviorMd": "# Agent Behavior\n...",
    "jiraWorkflowMd": "# Jira Workflow\n...",

    "jira": {
      "host": "https://yourorg.atlassian.net",
      "email": "you@example.com",
      "apiToken": "your-jira-api-token",
      "projectKey": "PROJ", // optional
      "maxTickets": 1
    },
    "bitbucket": {
      "username": "your-bb-username",
      "appPassword": "your-bb-app-password",
      "workspace": "your-workspace",
      "repo": "your-repo",
      "baseUrl": "https://api.bitbucket.org/2.0" // optional
    },
    "git": {
      "defaultBranch": "main"
    }
  }
}
```

#### Environment variables

Credentials can also be supplied via environment variables. The config file takes precedence when both are set.

| Variable                 | Description                       |
| ------------------------ | --------------------------------- |
| `JIRA_HOST`              | Jira base URL                     |
| `JIRA_EMAIL`             | Jira account email                |
| `JIRA_API_TOKEN`         | Jira API token                    |
| `JIRA_PROJECT_KEY`       | Project key filter (optional)     |
| `MAX_TICKETS`            | Max tickets per poll cycle        |
| `BITBUCKET_USERNAME`     | Bitbucket username                |
| `BITBUCKET_APP_PASSWORD` | Bitbucket app password            |
| `BITBUCKET_WORKSPACE`    | Bitbucket workspace slug          |
| `BITBUCKET_REPO`         | Repository slug                   |
| `BITBUCKET_BASE_URL`     | Bitbucket API base URL (optional) |
| `POLL_INTERVAL_MS`       | Poll interval in milliseconds     |

---

### Web UI

Dev agents are managed from the **Dev Agents** page in the OpenClaw web UI. Each agent has four tabs:

- **Config** — connect to Jira, Bitbucket, and Git.
- **Behavior** — Markdown editor for agent behavior rules (coding style, decision rules, constraints).
- **Jira Workflow** — Markdown editor for the step-by-step ticket processing workflow.
- **Logs** — live log console; click **Refresh** to reload.

---

### Instance lifecycle

| Status    | Meaning                                      |
| --------- | -------------------------------------------- |
| `stopped` | Agent is idle; will not poll Jira            |
| `running` | Agent is polling Jira and processing tickets |
| `paused`  | Agent is temporarily suspended mid-run       |

Use the **Start / Stop / Pause / Resume** buttons in the UI (or the gateway API) to control an instance.

---

### Source layout

```
src/agents/dev-agent/
├── config.ts          Config loader (openclaw.json + env vars)
├── dev-agent.ts       Core agent class (poll → plan → code → PR)
├── index.ts           Standalone entry point
├── llm.ts             LLM wrappers (planner, coder)
├── manager.ts         Multi-instance lifecycle manager
└── tools/
    ├── bitbucket.ts   Bitbucket PR creation
    ├── git.ts         Branch creation, commit, push
    └── jira.ts        Ticket fetching, status transitions
```

---

### Security notes

- API tokens and app passwords are stored locally in `~/.openclaw/dev-agent-instances.json`. Keep this file private (`chmod 600`).
- File paths generated by the LLM are validated to reject absolute paths and `..` traversal before being written to disk.
- Never commit `dev-agent-instances.json` or any file containing real credentials.
- Never commit `scripts/install.json` — it contains your API keys. It is listed in `.gitignore` by convention.
