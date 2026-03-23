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
