import { loadConfig } from "../../config/io.js";

export type DevAgentConfig = {
  pollIntervalMs: number;
  jira: {
    host: string;
    email: string;
    apiToken: string;
    projectKey?: string;
    maxTickets: number;
  };
  bitbucket: {
    username: string;
    appPassword: string;
    workspace: string;
    repo: string;
    baseUrl: string;
  };
  git: {
    defaultBranch: string;
  };
};

type RawSection = Record<string, unknown>;

function str(obj: RawSection | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(obj: RawSection | undefined, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === "number" && v > 0 ? v : undefined;
}

/**
 * Read dev-agent settings from agents.list[{id:"dev-agent"}].params, falling back to env vars.
 *
 * In openclaw.json:
 *   agents.list = [{ id: "dev-agent", params: { jira: {...}, bitbucket: {...}, git: {...} } }]
 */
export function loadDevAgentConfig(): DevAgentConfig {
  const openclaw = loadConfig();
  const agentEntry = openclaw.agents?.list?.find((e) => e.id === "dev-agent");
  const raw = (agentEntry?.params ?? {}) as RawSection;

  const jiraRaw = (raw.jira ?? {}) as RawSection;
  const bbRaw = (raw.bitbucket ?? {}) as RawSection;
  const gitRaw = (raw.git ?? {}) as RawSection;

  const jiraHost = str(jiraRaw, "host") ?? process.env.JIRA_HOST ?? "";
  const jiraEmail = str(jiraRaw, "email") ?? process.env.JIRA_EMAIL ?? "";
  const jiraApiToken = str(jiraRaw, "apiToken") ?? process.env.JIRA_API_TOKEN ?? "";

  if (!jiraHost || !jiraEmail || !jiraApiToken) {
    throw new Error(
      'Jira credentials are required. Set them in agents.list[{id:"dev-agent"}].params.jira ' +
        "in openclaw.json, or via JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN env vars.",
    );
  }

  const bbUsername = str(bbRaw, "username") ?? process.env.BITBUCKET_USERNAME ?? "";
  const bbAppPassword = str(bbRaw, "appPassword") ?? process.env.BITBUCKET_APP_PASSWORD ?? "";
  const bbWorkspace = str(bbRaw, "workspace") ?? process.env.BITBUCKET_WORKSPACE ?? "";
  const bbRepo = str(bbRaw, "repo") ?? process.env.BITBUCKET_REPO ?? "";

  if (!bbUsername || !bbAppPassword || !bbWorkspace || !bbRepo) {
    throw new Error(
      'Bitbucket credentials are required. Set them in agents.list[{id:"dev-agent"}].params.bitbucket ' +
        "in openclaw.json, or via BITBUCKET_* env vars.",
    );
  }

  return {
    pollIntervalMs:
      num(raw, "pollIntervalMs") ?? (parseInt(process.env.POLL_INTERVAL_MS ?? "0", 10) || 300_000),
    jira: {
      host: jiraHost,
      email: jiraEmail,
      apiToken: jiraApiToken,
      projectKey: str(jiraRaw, "projectKey") ?? process.env.JIRA_PROJECT_KEY,
      maxTickets: num(jiraRaw, "maxTickets") ?? (parseInt(process.env.MAX_TICKETS ?? "0", 10) || 1),
    },
    bitbucket: {
      username: bbUsername,
      appPassword: bbAppPassword,
      workspace: bbWorkspace,
      repo: bbRepo,
      baseUrl:
        str(bbRaw, "baseUrl") ?? process.env.BITBUCKET_BASE_URL ?? "https://api.bitbucket.org/2.0",
    },
    git: {
      defaultBranch: str(gitRaw, "defaultBranch") ?? "main",
    },
  };
}
