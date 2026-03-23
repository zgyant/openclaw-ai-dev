import { html, nothing } from "lit";
import type {
  DevAgentInstance,
  DevAgentLogEntry,
  DevAgentParams,
  DevAgentStatus,
} from "../controllers/dev-agents.ts";
import { icons } from "../icons.ts";

const DEFAULT_BEHAVIOR_MD = `# Agent Behavior

## Coding style
- Prefer TypeScript strict mode; always type function parameters.
- Use descriptive variable names; avoid single-letter identifiers.
- Follow the project's existing conventions — match patterns already in the codebase.

## Decision rules
- Only pick up tickets labeled \`agent-ready\`.
- If a ticket is ambiguous, leave a Jira comment with your questions and move on.
- Always write or update unit tests for new code.
- Keep commits small and focused; one logical change per commit.

## Constraints
- Do not modify production config files or secrets.
- Always create a feature branch; never push directly to \`main\`.
- Ask for clarification on any ticket that has no acceptance criteria.
- Do not merge your own pull requests — wait for human review.`;

const DEFAULT_WORKFLOW_MD = `# Jira Ticket Workflow

## 1. Assign & transition
- Assign the ticket to yourself.
- Move it to **In Progress**.

## 2. Understand the ticket
- Read the description and all comments carefully.
- If the requirements are unclear, post a Jira comment with specific questions and skip to the next ticket.

## 3. Implement
- Create a feature branch: \`feature/<TICKET-KEY>-short-description\`
- Implement the change following the project's coding conventions.
- Write or update unit tests.

## 4. Validate
- Run \`pnpm test\` and ensure all tests pass.
- Run \`pnpm check\` for lint and formatting.

## 5. Open pull request
- Push the branch and open a PR against \`main\`.
- Set the PR title to \`[<TICKET-KEY>] <Ticket summary>\`.
- Link the Jira ticket in the PR body.
- Move the ticket to **In Review**.`;

export type DevAgentsPanel = "config" | "behavior" | "workflow" | "logs";

export type DevAgentsFormState = {
  name: string;
  pollIntervalMs: string;
  behaviorMd: string;
  jiraWorkflowMd: string;
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraProjectKey: string;
  jiraMaxTickets: string;
  bbUsername: string;
  bbAppPassword: string;
  bbWorkspace: string;
  bbRepo: string;
  bbBaseUrl: string;
  gitDefaultBranch: string;
};

export type DevAgentsProps = {
  loading: boolean;
  error: string | null;
  instances: DevAgentInstance[] | null;
  selectedId: string | null;
  activePanel: DevAgentsPanel;
  logs: Record<string, DevAgentLogEntry[]>;
  logsLoading: boolean;
  busy: boolean;
  busyId: string | null;
  form: DevAgentsFormState | null;
  isCreating: boolean;
  saveError: string | null;
  /** Config storage path shown to the user, e.g. ~/.openclaw/dev-agent-instances.json */
  configPath?: string;
  onRefresh: () => void;
  onSelectInstance: (id: string) => void;
  onSelectPanel: (panel: DevAgentsPanel) => void;
  onStartNew: () => void;
  onCancelNew: () => void;
  onFormChange: (field: keyof DevAgentsFormState, value: string) => void;
  onSaveForm: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onLoadLogs: (id: string) => void;
};

export function defaultDevAgentsForm(instance?: DevAgentInstance): DevAgentsFormState {
  const p = instance?.params ?? {};
  const j = p.jira ?? {};
  const b = p.bitbucket ?? {};
  const g = p.git ?? {};
  return {
    name: instance?.name ?? "",
    pollIntervalMs: String(p.pollIntervalMs ?? 300000),
    behaviorMd: p.behaviorMd ?? DEFAULT_BEHAVIOR_MD,
    jiraWorkflowMd: p.jiraWorkflowMd ?? DEFAULT_WORKFLOW_MD,
    jiraHost: j.host ?? "",
    jiraEmail: j.email ?? "",
    jiraApiToken: j.apiToken ?? "",
    jiraProjectKey: j.projectKey ?? "",
    jiraMaxTickets: String(j.maxTickets ?? 1),
    bbUsername: b.username ?? "",
    bbAppPassword: b.appPassword ?? "",
    bbWorkspace: b.workspace ?? "",
    bbRepo: b.repo ?? "",
    bbBaseUrl: b.baseUrl ?? "",
    gitDefaultBranch: g.defaultBranch ?? "main",
  };
}

export function devAgentsFormToParams(form: DevAgentsFormState): DevAgentParams {
  return {
    pollIntervalMs: parseInt(form.pollIntervalMs, 10) || 300_000,
    behaviorMd: form.behaviorMd.trim() || undefined,
    jiraWorkflowMd: form.jiraWorkflowMd.trim() || undefined,
    jira: {
      host: form.jiraHost.trim() || undefined,
      email: form.jiraEmail.trim() || undefined,
      apiToken: form.jiraApiToken.trim() || undefined,
      projectKey: form.jiraProjectKey.trim() || undefined,
      maxTickets: parseInt(form.jiraMaxTickets, 10) || 1,
    },
    bitbucket: {
      username: form.bbUsername.trim() || undefined,
      appPassword: form.bbAppPassword.trim() || undefined,
      workspace: form.bbWorkspace.trim() || undefined,
      repo: form.bbRepo.trim() || undefined,
      baseUrl: form.bbBaseUrl.trim() || undefined,
    },
    git: {
      defaultBranch: form.gitDefaultBranch.trim() || "main",
    },
  };
}

function statusBadge(status: DevAgentStatus) {
  const map: Record<DevAgentStatus, { cls: string; label: string }> = {
    running: { cls: "chip chip-ok", label: "Running" },
    stopped: { cls: "chip", label: "Stopped" },
    paused: { cls: "chip chip-warn", label: "Paused" },
  };
  const { cls, label } = map[status];
  return html`<span class=${cls}>${label}</span>`;
}

function renderControlButtons(props: DevAgentsProps, inst: DevAgentInstance) {
  const isBusy = props.busy && props.busyId === inst.id;
  if (inst.status === "running") {
    return html`
      <button
        class="btn btn--icon"
        title="Pause agent"
        ?disabled=${isBusy}
        @click=${(e: Event) => {
          e.stopPropagation();
          props.onPause(inst.id);
        }}
      >
        ${icons.loader}
      </button>
      <button
        class="btn btn--icon"
        title="Stop agent"
        ?disabled=${isBusy}
        @click=${(e: Event) => {
          e.stopPropagation();
          props.onStop(inst.id);
        }}
      >
        ${icons.stop}
      </button>
    `;
  }
  if (inst.status === "paused") {
    return html`
      <button
        class="btn btn--icon"
        title="Resume agent"
        ?disabled=${isBusy}
        @click=${(e: Event) => {
          e.stopPropagation();
          props.onResume(inst.id);
        }}
      >
        ${icons.zap}
      </button>
      <button
        class="btn btn--icon"
        title="Stop agent"
        ?disabled=${isBusy}
        @click=${(e: Event) => {
          e.stopPropagation();
          props.onStop(inst.id);
        }}
      >
        ${icons.stop}
      </button>
    `;
  }
  // stopped
  return html`
    <button
      class="btn btn--icon"
      title="Start agent"
      ?disabled=${isBusy}
      @click=${(e: Event) => {
        e.stopPropagation();
        props.onStart(inst.id);
      }}
    >
      ${icons.zap}
    </button>
  `;
}

function renderInstanceList(props: DevAgentsProps) {
  const instances = props.instances ?? [];
  return html`
    <div class="dev-agents-list">
      <div class="dev-agents-list__header">
        <div class="dev-agents-list__header-left">
          <span class="dev-agents-list__icon">${icons.brain}</span>
          <span class="dev-agents-list__title">Dev Agents</span>
        </div>
        <button class="btn btn--sm" @click=${props.onStartNew} title="Create a new dev agent">
          ${icons.plus} New
        </button>
      </div>
      ${
        instances.length === 0
          ? html`
              <div class="dev-agents-list__empty">
                <div class="dev-agents-list__empty-icon">${icons.brain}</div>
                <p class="dev-agents-list__empty-title">No agents yet</p>
                <p class="dev-agents-list__empty-hint">Click <strong>New</strong> to create your first dev agent.</p>
              </div>
            `
          : instances.map((inst) => {
              const isSelected = inst.id === props.selectedId;
              const created = new Date(inst.createdAtMs).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              });
              return html`
                <div
                  class="dev-agents-list__item ${isSelected ? "dev-agents-list__item--active" : ""}"
                  @click=${() => {
                    props.onSelectInstance(inst.id);
                  }}
                  role="button"
                  tabindex="0"
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      props.onSelectInstance(inst.id);
                    }
                  }}
                >
                  <div class="dev-agents-list__item-info">
                    <span class="dev-agents-list__item-name">${inst.name}</span>
                    <span class="dev-agents-list__item-meta">Created ${created}</span>
                  </div>
                  <div class="dev-agents-list__item-right">
                    ${statusBadge(inst.status)}
                    <div class="dev-agents-list__item-actions">
                      ${renderControlButtons(props, inst)}
                    </div>
                  </div>
                </div>
              `;
            })
      }
    </div>
  `;
}

function renderFormField(
  label: string,
  field: keyof DevAgentsFormState,
  form: DevAgentsFormState,
  onFormChange: DevAgentsProps["onFormChange"],
  opts: { type?: string; placeholder?: string; hint?: string } = {},
) {
  return html`
    <div class="field">
      <label class="field__label">${label}</label>
      ${opts.hint ? html`<div class="field__hint">${opts.hint}</div>` : nothing}
      <input
        class="field__input"
        type=${opts.type ?? "text"}
        placeholder=${opts.placeholder ?? ""}
        .value=${form[field]}
        @input=${(e: Event) => {
          onFormChange(field, (e.target as HTMLInputElement).value);
        }}
      />
    </div>
  `;
}

function renderTextareaField(
  label: string,
  field: keyof DevAgentsFormState,
  form: DevAgentsFormState,
  onFormChange: DevAgentsProps["onFormChange"],
  opts: { placeholder?: string; hint?: string; rows?: number } = {},
) {
  return html`
    <div class="field">
      <label class="field__label">${label}</label>
      ${opts.hint ? html`<div class="field__hint">${opts.hint}</div>` : nothing}
      <textarea
        class="field__input dev-agents-md-editor"
        placeholder=${opts.placeholder ?? ""}
        rows=${opts.rows ?? 12}
        .value=${form[field]}
        @input=${(e: Event) => {
          onFormChange(field, (e.target as HTMLTextAreaElement).value);
        }}
      ></textarea>
    </div>
  `;
}

function renderSaveBar(props: DevAgentsProps, inst: DevAgentInstance | null, isSaving: boolean) {
  const { isCreating } = props;
  return html`
    ${
      props.saveError
        ? html`<div class="callout danger" style="margin-top: 8px;">${props.saveError}</div>`
        : nothing
    }
    <div class="row" style="gap: 8px; margin-top: 16px;">
      <button class="btn primary" ?disabled=${isSaving} @click=${props.onSaveForm}>
        ${isSaving ? "Saving…" : isCreating ? "Create Agent" : "Save Changes"}
      </button>
      ${
        isCreating ? html`<button class="btn" @click=${props.onCancelNew}>Cancel</button>` : nothing
      }
      ${
        inst && !isCreating
          ? html`
              <button
                class="btn danger"
                style="margin-left: auto;"
                ?disabled=${isSaving}
                @click=${() => {
                  if (confirm(`Delete "${inst.name}"? This cannot be undone.`)) {
                    props.onDelete(inst.id);
                  }
                }}
              >
                ${icons.trash} Delete Agent
              </button>
            `
          : nothing
      }
    </div>
  `;
}

function renderConfigPanel(props: DevAgentsProps, inst: DevAgentInstance | null) {
  const { form } = props;
  if (!form) {
    return nothing;
  }
  const isSaving = props.busy && (!inst || props.busyId === inst?.id || props.busyId === null);
  const onFormChange = props.onFormChange;
  const configPath = props.configPath ?? "~/.openclaw/dev-agent-instances.json";

  return html`
    <div class="dev-agents-config">

      ${
        inst
          ? html`
              <div class="dev-agents-path-bar">
                ${icons.fileText}
                <span class="dev-agents-path-bar__label">Config stored at</span>
                <code class="dev-agents-path-bar__path">${configPath}</code>
              </div>
            `
          : nothing
      }

      <details class="card-section" open>
        <summary class="card-section__title">
          <span class="card-section__title-left">${icons.settings} General</span>
          <span class="card-section__chevron">${icons.chevronDown}</span>
        </summary>
        <div class="card-section__body">
          ${renderFormField("Agent name", "name", form, onFormChange, { placeholder: "e.g. Backend Agent" })}
          ${renderFormField("Poll interval", "pollIntervalMs", form, onFormChange, {
            type: "number",
            placeholder: "300000",
            hint: "How often the agent checks for new Jira tickets (in milliseconds). Default: 300000 (5 min).",
          })}
        </div>
      </details>

      <details class="card-section">
        <summary class="card-section__title">
          <span class="card-section__title-left">${icons.link} Jira</span>
          <span class="card-section__chevron">${icons.chevronDown}</span>
        </summary>
        <div class="card-section__body">
          ${renderFormField("Host URL", "jiraHost", form, onFormChange, {
            placeholder: "https://yourorg.atlassian.net",
          })}
          ${renderFormField("Email", "jiraEmail", form, onFormChange, {
            type: "email",
            placeholder: "you@example.com",
          })}
          ${renderFormField("API token", "jiraApiToken", form, onFormChange, {
            type: "password",
            placeholder: "Jira API token",
            hint: "Generate from Atlassian account settings → Security → API tokens.",
          })}
          ${renderFormField("Project key", "jiraProjectKey", form, onFormChange, {
            placeholder: "PROJ (leave blank to watch all projects)",
          })}
          ${renderFormField("Max tickets per poll", "jiraMaxTickets", form, onFormChange, {
            type: "number",
            placeholder: "1",
            hint: "Limit concurrent tickets the agent works on per cycle.",
          })}
        </div>
      </details>

      <details class="card-section">
        <summary class="card-section__title">
          <span class="card-section__title-left">${icons.folder} Bitbucket</span>
          <span class="card-section__chevron">${icons.chevronDown}</span>
        </summary>
        <div class="card-section__body">
          ${renderFormField("Username", "bbUsername", form, onFormChange, {
            placeholder: "bitbucket-username",
          })}
          ${renderFormField("App password", "bbAppPassword", form, onFormChange, {
            type: "password",
            placeholder: "Bitbucket app password",
            hint: "Create in Bitbucket → Personal settings → App passwords.",
          })}
          ${renderFormField("Workspace", "bbWorkspace", form, onFormChange, {
            placeholder: "my-workspace",
          })}
          ${renderFormField("Repository", "bbRepo", form, onFormChange, {
            placeholder: "my-repo",
          })}
          ${renderFormField("Base URL", "bbBaseUrl", form, onFormChange, {
            placeholder: "Leave blank to use https://api.bitbucket.org/2.0",
          })}
        </div>
      </details>

      <details class="card-section">
        <summary class="card-section__title">
          <span class="card-section__title-left">${icons.scrollText} Git</span>
          <span class="card-section__chevron">${icons.chevronDown}</span>
        </summary>
        <div class="card-section__body">
          ${renderFormField("Default branch", "gitDefaultBranch", form, onFormChange, {
            placeholder: "main",
            hint: "Branch the agent creates feature branches from.",
          })}
        </div>
      </details>

      ${renderSaveBar(props, inst, isSaving)}
    </div>
  `;
}

function renderBehaviorPanel(props: DevAgentsProps, inst: DevAgentInstance | null) {
  const { form } = props;
  if (!form) {
    return nothing;
  }
  const isSaving = props.busy && (!inst || props.busyId === inst?.id || props.busyId === null);
  const onFormChange = props.onFormChange;

  return html`
    <div class="dev-agents-config">
      <div class="callout info" style="margin-bottom: 16px;">
        <strong>Agent behavior</strong> — Define how the agent should think, act, and make decisions. Written in Markdown, this becomes part of the agent's system prompt.
      </div>

      ${renderTextareaField("Behavior rules", "behaviorMd", form, onFormChange, {
        rows: 20,
        hint: "Describe the agent's personality, decision rules, coding style, constraints, and anything else that should guide its behavior.",
      })}

      ${renderSaveBar(props, inst, isSaving)}
    </div>
  `;
}

function renderWorkflowPanel(props: DevAgentsProps, inst: DevAgentInstance | null) {
  const { form } = props;
  if (!form) {
    return nothing;
  }
  const isSaving = props.busy && (!inst || props.busyId === inst?.id || props.busyId === null);
  const onFormChange = props.onFormChange;

  return html`
    <div class="dev-agents-config">
      <div class="callout info" style="margin-bottom: 16px;">
        <strong>Jira workflow</strong> — Describe the exact steps the agent should follow when processing a Jira ticket, from picking it up to opening a pull request.
      </div>

      ${renderTextareaField("Workflow definition", "jiraWorkflowMd", form, onFormChange, {
        rows: 20,
        hint: "Use Markdown to define the end-to-end ticket processing steps. The agent will follow these instructions when it picks up a new ticket.",
      })}

      ${renderSaveBar(props, inst, isSaving)}
    </div>
  `;
}

function renderLogsPanel(props: DevAgentsProps, inst: DevAgentInstance) {
  const logs = props.logs[inst.id] ?? [];
  return html`
    <div class="dev-agents-logs">
      <div class="dev-agents-logs__toolbar">
        <span class="muted" style="font-size: 12px;">${logs.length} log line${logs.length === 1 ? "" : "s"}</span>
        <button
          class="btn btn--small"
          ?disabled=${props.logsLoading}
          @click=${() => props.onLoadLogs(inst.id)}
        >
          ${props.logsLoading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div class="dev-agents-log-console">
        ${
          logs.length === 0
            ? html`
                <div class="dev-agents-log-empty">
                  ${icons.terminal}
                  <span>No output yet — start the agent to see logs here.</span>
                </div>
              `
            : logs.map(
                (entry) => html`
                  <div class="dev-agents-log-line">
                    <span class="dev-agents-log-ts">${new Date(entry.ts).toLocaleTimeString()}</span>
                    <span class="dev-agents-log-text">${entry.line}</span>
                  </div>
                `,
              )
        }
      </div>
    </div>
  `;
}

function renderDetailPanel(props: DevAgentsProps) {
  const { isCreating, selectedId, instances, activePanel } = props;

  if (isCreating) {
    return html`
      <div class="dev-agents-detail">
        <div class="dev-agents-detail__header">
          <div>
            <h2 class="dev-agents-detail__title">New Dev Agent</h2>
            <p class="dev-agents-detail__subtitle">Configure connections, define behavior, and set up the Jira workflow.</p>
          </div>
        </div>
        <div class="tab-bar" style="margin-top: 4px;">
          <button
            class="tab-bar__item ${activePanel === "config" ? "tab-bar__item--active" : ""}"
            @click=${() => props.onSelectPanel("config")}
          >
            ${icons.settings} Config
          </button>
          <button
            class="tab-bar__item ${activePanel === "behavior" ? "tab-bar__item--active" : ""}"
            @click=${() => props.onSelectPanel("behavior")}
          >
            ${icons.brain} Behavior
          </button>
          <button
            class="tab-bar__item ${activePanel === "workflow" ? "tab-bar__item--active" : ""}"
            @click=${() => props.onSelectPanel("workflow")}
          >
            ${icons.scrollText} Jira Workflow
          </button>
        </div>
        <div class="dev-agents-detail__body">
          ${activePanel === "config" ? renderConfigPanel(props, null) : nothing}
          ${activePanel === "behavior" ? renderBehaviorPanel(props, null) : nothing}
          ${activePanel === "workflow" ? renderWorkflowPanel(props, null) : nothing}
        </div>
      </div>
    `;
  }

  const inst = (instances ?? []).find((i) => i.id === selectedId) ?? null;
  if (!inst) {
    return html`
      <div class="dev-agents-detail dev-agents-detail--empty">
        <div class="dev-agents-detail__empty-state">
          <div class="dev-agents-detail__empty-icon">${icons.brain}</div>
          <p class="dev-agents-detail__empty-title">No agent selected</p>
          <p class="dev-agents-detail__empty-hint">Select an agent from the list on the left, or create a new one.</p>
          <button class="btn primary" @click=${props.onStartNew}>${icons.plus} New Agent</button>
        </div>
      </div>
    `;
  }

  const isBusy = props.busy && props.busyId === inst.id;

  return html`
    <div class="dev-agents-detail">
      <div class="dev-agents-detail__header">
        <div>
          <h2 class="dev-agents-detail__title">${inst.name}</h2>
          <div class="dev-agents-detail__meta">
            ${statusBadge(inst.status)}
            <span class="dev-agents-detail__created muted">
              Created ${new Date(inst.createdAtMs).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
        <div class="row" style="gap: 8px; align-items: center;">
          ${renderControlButtons(props, inst)}
          <button
            class="btn btn--icon"
            title="Refresh agent list"
            ?disabled=${props.loading}
            @click=${props.onRefresh}
          >
            ${icons.refresh}
          </button>
        </div>
      </div>

      <div class="tab-bar" style="margin-top: 8px;">
        <button
          class="tab-bar__item ${activePanel === "config" ? "tab-bar__item--active" : ""}"
          @click=${() => props.onSelectPanel("config")}
        >
          ${icons.settings} Config
        </button>
        <button
          class="tab-bar__item ${activePanel === "behavior" ? "tab-bar__item--active" : ""}"
          @click=${() => props.onSelectPanel("behavior")}
        >
          ${icons.brain} Behavior
        </button>
        <button
          class="tab-bar__item ${activePanel === "workflow" ? "tab-bar__item--active" : ""}"
          @click=${() => props.onSelectPanel("workflow")}
        >
          ${icons.scrollText} Jira Workflow
        </button>
        <button
          class="tab-bar__item ${activePanel === "logs" ? "tab-bar__item--active" : ""}"
          @click=${() => {
            props.onSelectPanel("logs");
            props.onLoadLogs(inst.id);
          }}
        >
          ${icons.terminal} Logs
        </button>
      </div>

      <div class="dev-agents-detail__body">
        ${activePanel === "config" ? renderConfigPanel(props, inst) : nothing}
        ${activePanel === "behavior" ? renderBehaviorPanel(props, inst) : nothing}
        ${activePanel === "workflow" ? renderWorkflowPanel(props, inst) : nothing}
        ${activePanel === "logs" && !isBusy ? renderLogsPanel(props, inst) : nothing}
      </div>
    </div>
  `;
}

export function renderDevAgents(props: DevAgentsProps) {
  return html`
    <section class="card dev-agents-shell">
      <div class="dev-agents-layout">
        <div class="dev-agents-sidebar">
          ${
            props.loading
              ? html`
                  <div class="dev-agents-loading">
                    ${icons.loader}
                    <span class="muted">Loading agents…</span>
                  </div>
                `
              : nothing
          }
          ${
            props.error
              ? html`<div class="callout danger" style="margin: 12px;">${props.error}</div>`
              : nothing
          }
          ${renderInstanceList(props)}
        </div>
        <div class="dev-agents-main">
          ${renderDetailPanel(props)}
        </div>
      </div>
    </section>
  `;
}
