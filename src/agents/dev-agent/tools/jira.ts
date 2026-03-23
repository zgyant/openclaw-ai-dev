import JiraApi from "jira-client";
import type { DevAgentConfig } from "../config.js";

function makeClient(cfg: DevAgentConfig["jira"]) {
  return new JiraApi({
    protocol: "https",
    host: cfg.host,
    username: cfg.email,
    password: cfg.apiToken,
    apiVersion: "3",
  });
}

export async function getAssignedTickets(cfg: DevAgentConfig["jira"]) {
  const jira = makeClient(cfg);
  // Fetch tickets assigned to me that are still in a "ready to work" state.
  const projectFilter = cfg.projectKey ? ` AND project = "${cfg.projectKey}"` : "";
  const res = await jira.searchJira(
    `assignee = currentUser() AND status in ("To Do","Open","Reopened","Backlog")${projectFilter} ORDER BY priority ASC`,
    { maxResults: cfg.maxTickets },
  );

  return res.issues.map(
    (i: {
      id: string;
      key: string;
      fields: { summary: string; description: { content?: { content?: { text?: string }[] }[] } };
    }) => ({
      id: i.id,
      key: i.key,
      summary: i.fields.summary,
      description: extractText(i.fields.description),
    }),
  );
}

function extractText(desc: { content?: { content?: { text?: string }[] }[] } | undefined): string {
  if (!desc?.content) {
    return "";
  }
  return desc.content
    .flatMap(
      (b: { content?: { text?: string }[] }) =>
        b.content?.map((c: { text?: string }) => c.text || "") || [],
    )
    .join("\n");
}

async function findTransition(
  jira: JiraApi,
  issueId: string,
  namePart: string,
): Promise<string | undefined> {
  const t = await jira.listTransitions(issueId);
  return t.transitions.find((x: { id: string; name: string }) =>
    x.name.toLowerCase().includes(namePart),
  )?.id;
}

/** Mark the ticket as "In Progress" when work begins. */
export async function moveToInProgress(
  cfg: DevAgentConfig["jira"],
  issueId: string,
): Promise<void> {
  const jira = makeClient(cfg);
  const id = await findTransition(jira, issueId, "progress");
  if (!id) {
    console.warn(`⚠️  No "In Progress" transition found for ${issueId}`);
    return;
  }
  await jira.transitionIssue(issueId, { transition: { id } });
}

/** Mark the ticket as "In Review" / "Code Review" when a PR is ready. */
export async function moveToReview(cfg: DevAgentConfig["jira"], issueId: string): Promise<void> {
  const jira = makeClient(cfg);
  const id = await findTransition(jira, issueId, "review");
  if (!id) {
    console.warn(`⚠️  No "Review" transition found for ${issueId}`);
    return;
  }
  await jira.transitionIssue(issueId, { transition: { id } });
}
