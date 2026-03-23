import fs from "fs/promises";
import path from "path";
import type { DevAgentConfig } from "./config.js";
import { planner, coder } from "./llm.js";
import { createPR } from "./tools/bitbucket.js";
import { createBranch, commitAndPush } from "./tools/git.js";
import { getAssignedTickets, moveToInProgress, moveToReview } from "./tools/jira.js";

type Ticket = { id: string; key: string; summary: string; description: string };

type PlanResult = { steps: string[] };

type FileSpec = { path: string; content: string };

type CodeResult = { files: FileSpec[] };

export class DevAgent {
  private readonly onLog: (line: string) => void;

  constructor(
    private readonly cfg: DevAgentConfig,
    onLog?: (line: string) => void,
  ) {
    this.onLog = onLog ?? ((line) => console.log(line));
  }

  async run(): Promise<void> {
    const tickets = await getAssignedTickets(this.cfg.jira);
    if (tickets.length === 0) {
      this.onLog("🎉 No tickets to process.");
      return;
    }
    for (const ticket of tickets) {
      try {
        await this.handle(ticket);
      } catch (err) {
        this.onLog(`❌ Failed to process ${ticket.key}: ${String(err)}`);
      }
    }
  }

  async handle(ticket: Ticket): Promise<void> {
    this.onLog(`➡️  Processing ${ticket.key} - ${ticket.summary}`);

    await moveToInProgress(this.cfg.jira, ticket.id);

    const plan = (await planner(
      `Ticket: ${ticket.summary}\nDescription: ${ticket.description}\nReturn JSON with steps.`,
      {
        type: "object",
        properties: { steps: { type: "array", items: { type: "string" } } },
        required: ["steps"],
      },
    )) as PlanResult;

    this.onLog(`📋 Plan: ${JSON.stringify(plan.steps)}`);

    const code = (await coder(
      `Ticket: ${ticket.summary}\nPlan: ${JSON.stringify(plan)}\nReturn JSON with files: { path, content }. Use relative paths from the repo root.`,
      {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: {
              type: "object",
              properties: { path: { type: "string" }, content: { type: "string" } },
              required: ["path", "content"],
            },
          },
        },
        required: ["files"],
      },
    )) as CodeResult;

    const branch = createBranch(this.cfg.git, ticket.key);

    for (const file of code.files) {
      // Prevent path traversal: reject absolute paths and any `..` segments.
      if (path.isAbsolute(file.path) || file.path.split("/").includes("..")) {
        throw new Error(`Unsafe file path rejected: ${file.path}`);
      }
      const dir = path.dirname(file.path);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file.path, file.content, "utf8");
    }

    commitAndPush(branch, `${ticket.key}: ${ticket.summary}`);

    const pr = await createPR(this.cfg.bitbucket, this.cfg.git.defaultBranch, branch, ticket);

    await moveToReview(this.cfg.jira, ticket.id);

    this.onLog(`✅ PR created: ${pr.links?.html?.href ?? pr.url ?? "(no URL)"}`);
  }
}
