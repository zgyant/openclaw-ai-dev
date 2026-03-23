import { spawnSync } from "child_process";
import type { DevAgentConfig } from "../config.js";

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: "inherit", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git command failed: ${cmd} ${args.join(" ")} (exit ${result.status ?? "null"})`,
    );
  }
}

// Sanitize a Jira ticket key into a safe branch-name segment (e.g. "PROJ-123").
function sanitizeBranchSegment(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function createBranch(cfg: DevAgentConfig["git"], ticketKey: string): string {
  // Always branch from the default remote HEAD so we start clean.
  run("git", ["fetch", "origin"]);
  run("git", ["checkout", `origin/${cfg.defaultBranch}`, "--no-track"]);
  const branch = `feature/${sanitizeBranchSegment(ticketKey)}`;
  run("git", ["checkout", "-b", branch]);
  return branch;
}

export function commitAndPush(branch: string, message: string): void {
  run("git", ["add", "."]);
  run("git", ["commit", "-m", message]);
  run("git", ["push", "origin", branch]);
}
