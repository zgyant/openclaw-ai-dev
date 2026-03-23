# Dev Agent

A fully automated coding agent that polls Jira for assigned tickets, implements the required changes using an LLM, and opens a Bitbucket pull request — all without manual intervention.

## How it works

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

## Configuration

Instances are persisted to `~/.openclaw/dev-agent-instances.json`.

Each instance stores a `params` object with three sections:

```jsonc
{
  "id": "abc123",
  "name": "Backend Agent",
  "status": "stopped",
  "createdAtMs": 1742900000000,
  "params": {
    "pollIntervalMs": 300000,

    // --- Agent behavior (Markdown, injected as system prompt) ---
    "behaviorMd": "# Agent Behavior\n...",
    "jiraWorkflowMd": "# Jira Workflow\n...",

    "jira": {
      "host": "https://yourorg.atlassian.net",
      "email": "you@example.com",
      "apiToken": "your-jira-api-token",
      "projectKey": "PROJ", // optional — omit to watch all projects
      "maxTickets": 1,
    },
    "bitbucket": {
      "username": "your-bb-username",
      "appPassword": "your-bb-app-password",
      "workspace": "your-workspace",
      "repo": "your-repo",
      "baseUrl": "https://api.bitbucket.org/2.0", // optional
    },
    "git": {
      "defaultBranch": "main",
    },
  },
}
```

### Alternative: environment variables

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

## Web UI

Dev agents are managed from the **Dev Agents** page in the OpenClaw web UI. The page has four tabs per agent:

### Config

Connect the agent to Jira, Bitbucket, and Git. Fields:

| Field                  | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| Agent name             | Display name for this instance                                   |
| Poll interval          | How often the agent checks for new tickets (ms)                  |
| Jira host              | `https://yourorg.atlassian.net`                                  |
| Jira email             | Account email for API auth                                       |
| Jira API token         | Generate at Atlassian → Account Settings → Security → API tokens |
| Project key            | Filter tickets to a single project (optional)                    |
| Max tickets per poll   | How many tickets to process per cycle                            |
| Bitbucket username     | Your Bitbucket username                                          |
| Bitbucket app password | Generate at Bitbucket → Personal Settings → App passwords        |
| Workspace              | Bitbucket workspace slug                                         |
| Repository             | Bitbucket repository slug                                        |
| Base URL               | Override Bitbucket API base (leave blank for default)            |
| Default branch         | Branch that PRs target (e.g. `main`)                             |

### Behavior

A Markdown editor for the **agent behavior rules** — a system-prompt-level definition of how the agent thinks and acts:

```markdown
# Agent Behavior

## Coding style

- Use TypeScript strict mode; always type function parameters.
- Prefer descriptive variable names.

## Decision rules

- Only pick up tickets labeled `agent-ready`.
- If a ticket is ambiguous, leave a Jira comment and skip it.
- Always write tests for new code.

## Constraints

- Do not modify production config files.
- Never push directly to main — always use a feature branch.
```

### Jira Workflow

A Markdown editor for the **step-by-step workflow** the agent follows when processing a Jira ticket:

```markdown
# Jira Ticket Workflow

## 1. Assign & transition

- Assign the ticket to yourself.
- Move it to **In Progress**.

## 2. Understand the ticket

- Read the description and all comments.
- If unclear, post a Jira comment with questions and skip to the next ticket.

## 3. Implement

- Create a feature branch: `feature/<TICKET-KEY>-short-description`
- Implement the change following the project's coding conventions.
- Write or update unit tests.

## 4. Validate

- Run `pnpm test` and ensure it passes.
- Run `pnpm check` for lint/format.

## 5. Open pull request

- Push the branch and open a PR against `main`.
- Set the PR title to `[<TICKET-KEY>] <Ticket summary>`.
- Link the Jira ticket in the PR body.
- Move the ticket to **In Review**.
```

### Logs

A live log console showing per-ticket processing output. Click **Refresh** to reload.

---

## Instance lifecycle

| Status    | Meaning                                      |
| --------- | -------------------------------------------- |
| `stopped` | Agent is idle; will not poll Jira            |
| `running` | Agent is polling Jira and processing tickets |
| `paused`  | Agent is temporarily suspended mid-run       |

Use the **Start / Stop / Pause / Resume** buttons in the UI (or the gateway API) to control an instance.

---

## Source layout

```
src/agents/dev-agent/
├── config.ts          Config loader (openclaw.json + env vars)
├── dev-agent.ts       Core agent class (poll → plan → code → PR)
├── index.ts           Standalone entry point
├── llm.ts             LLM wrappers (planner, coder)
├── manager.ts         Multi-instance lifecycle manager (gateway use)
└── tools/
    ├── bitbucket.ts   Bitbucket PR creation
    ├── git.ts         Branch creation, commit, push
    └── jira.ts        Ticket fetching, status transitions
```

The gateway exposes these JSON-RPC methods (see `src/gateway/server-methods/dev-agents.ts`):

| Method              | Description            |
| ------------------- | ---------------------- |
| `dev-agents.list`   | List all instances     |
| `dev-agents.create` | Create a new instance  |
| `dev-agents.update` | Update name/params     |
| `dev-agents.delete` | Delete an instance     |
| `dev-agents.start`  | Start polling          |
| `dev-agents.stop`   | Stop polling           |
| `dev-agents.pause`  | Pause mid-run          |
| `dev-agents.resume` | Resume after pause     |
| `dev-agents.logs`   | Fetch recent log lines |

---

## Security notes

- API tokens and app passwords are stored locally in `~/.openclaw/dev-agent-instances.json`. Keep this file private (`chmod 600`).
- File paths generated by the LLM are validated to reject absolute paths and `..` traversal before being written to disk.
- Never commit `dev-agent-instances.json` or any file containing real credentials.
