import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { DevAgent } from "./dev-agent.js";

export type DevAgentStatus = "stopped" | "running" | "paused";

export type DevAgentParams = {
  pollIntervalMs?: number;
  jira?: {
    host?: string;
    email?: string;
    apiToken?: string;
    projectKey?: string;
    maxTickets?: number;
  };
  bitbucket?: {
    username?: string;
    appPassword?: string;
    workspace?: string;
    repo?: string;
    baseUrl?: string;
  };
  git?: {
    defaultBranch?: string;
  };
};

export type DevAgentInstanceDef = {
  id: string;
  name: string;
  params: DevAgentParams;
  status: DevAgentStatus;
  createdAtMs: number;
};

export type DevAgentLogEntry = {
  ts: number;
  line: string;
};

type BroadcastFn = (event: string, payload: unknown) => void;

const LOG_RING_SIZE = 500;
const INSTANCES_FILE = "dev-agent-instances.json";

function buildConfig(params: DevAgentParams): {
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
  git: { defaultBranch: string };
} {
  const jira = params.jira ?? {};
  const bb = params.bitbucket ?? {};
  const host = jira.host?.trim() ?? "";
  const email = jira.email?.trim() ?? "";
  const apiToken = jira.apiToken?.trim() ?? "";
  if (!host || !email || !apiToken) {
    throw new Error("Jira host, email, and apiToken are required to start the agent.");
  }
  const username = bb.username?.trim() ?? "";
  const appPassword = bb.appPassword?.trim() ?? "";
  const workspace = bb.workspace?.trim() ?? "";
  const repo = bb.repo?.trim() ?? "";
  if (!username || !appPassword || !workspace || !repo) {
    throw new Error(
      "Bitbucket username, appPassword, workspace, and repo are required to start the agent.",
    );
  }
  return {
    pollIntervalMs: params.pollIntervalMs ?? 300_000,
    jira: {
      host,
      email,
      apiToken,
      projectKey: jira.projectKey?.trim() || undefined,
      maxTickets: jira.maxTickets ?? 1,
    },
    bitbucket: {
      username,
      appPassword,
      workspace,
      repo,
      baseUrl: bb.baseUrl?.trim() || "https://api.bitbucket.org/2.0",
    },
    git: {
      defaultBranch: params.git?.defaultBranch?.trim() || "main",
    },
  };
}

export class DevAgentManager {
  private instances: Map<string, DevAgentInstanceDef> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private logs: Map<string, DevAgentLogEntry[]> = new Map();
  private broadcast: BroadcastFn | null = null;
  private stateDir: string;

  constructor(stateDir?: string) {
    this.stateDir = stateDir ?? resolveStateDir();
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  private instancesFilePath(): string {
    return path.join(this.stateDir, INSTANCES_FILE);
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.instancesFilePath(), "utf-8");
      const parsed = JSON.parse(raw) as DevAgentInstanceDef[];
      for (const def of parsed) {
        if (!def?.id) {
          continue;
        }
        // Always reset to stopped on load — running is transient runtime state.
        this.instances.set(def.id, { ...def, status: "stopped" });
        this.logs.set(def.id, []);
      }
    } catch {
      // File may not exist yet — fine.
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const defs = [...this.instances.values()].map((def) => ({
      ...def,
      status: "stopped" as DevAgentStatus,
    }));
    await fs.writeFile(this.instancesFilePath(), JSON.stringify(defs, null, 2), "utf-8");
  }

  list(): DevAgentInstanceDef[] {
    return [...this.instances.values()];
  }

  get(id: string): DevAgentInstanceDef | undefined {
    return this.instances.get(id);
  }

  async create(params: { name: string; params: DevAgentParams }): Promise<DevAgentInstanceDef> {
    const id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const def: DevAgentInstanceDef = {
      id,
      name: params.name.trim() || "Dev Agent",
      params: params.params,
      status: "stopped",
      createdAtMs: Date.now(),
    };
    this.instances.set(id, def);
    this.logs.set(id, []);
    await this.save();
    return def;
  }

  async update(
    id: string,
    params: { name?: string; params?: DevAgentParams },
  ): Promise<DevAgentInstanceDef | null> {
    const def = this.instances.get(id);
    if (!def) {
      return null;
    }
    const updated: DevAgentInstanceDef = {
      ...def,
      name: params.name !== undefined ? params.name.trim() || def.name : def.name,
      params: params.params !== undefined ? params.params : def.params,
    };
    this.instances.set(id, updated);
    await this.save();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.instances.has(id)) {
      return false;
    }
    this.stop(id);
    this.instances.delete(id);
    this.logs.delete(id);
    await this.save();
    return true;
  }

  start(id: string): { ok: boolean; error?: string } {
    const def = this.instances.get(id);
    if (!def) {
      return { ok: false, error: "Instance not found." };
    }
    if (def.status === "running") {
      return { ok: false, error: "Already running." };
    }
    // Validate config upfront so the user gets immediate feedback.
    try {
      buildConfig(def.params);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    def.status = "running";
    this.instances.set(id, def);
    this.broadcastStatus(id, "running");
    this.scheduleRun(id);
    return { ok: true };
  }

  stop(id: string): boolean {
    const def = this.instances.get(id);
    if (!def) {
      return false;
    }
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    if (def.status !== "stopped") {
      def.status = "stopped";
      this.instances.set(id, def);
      this.broadcastStatus(id, "stopped");
    }
    return true;
  }

  pause(id: string): boolean {
    const def = this.instances.get(id);
    if (!def || def.status !== "running") {
      return false;
    }
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    def.status = "paused";
    this.instances.set(id, def);
    this.broadcastStatus(id, "paused");
    return true;
  }

  resume(id: string): { ok: boolean; error?: string } {
    const def = this.instances.get(id);
    if (!def) {
      return { ok: false, error: "Instance not found." };
    }
    if (def.status !== "paused") {
      return { ok: false, error: "Instance is not paused." };
    }
    return this.start(id);
  }

  getLogs(id: string, limit = 200): DevAgentLogEntry[] {
    const ring = this.logs.get(id) ?? [];
    return ring.slice(-limit);
  }

  private broadcastStatus(id: string, status: DevAgentStatus): void {
    this.broadcast?.("dev-agents.status", { instanceId: id, status });
  }

  private appendLog(id: string, line: string): void {
    const entry: DevAgentLogEntry = { ts: Date.now(), line };
    const ring = this.logs.get(id) ?? [];
    ring.push(entry);
    if (ring.length > LOG_RING_SIZE) {
      ring.shift();
    }
    this.logs.set(id, ring);
    this.broadcast?.("dev-agents.log", { instanceId: id, ts: entry.ts, line });
  }

  private scheduleRun(id: string): void {
    const def = this.instances.get(id);
    if (!def || def.status !== "running") {
      return;
    }
    void this.runOnce(id).finally(() => {
      const current = this.instances.get(id);
      if (!current || current.status !== "running") {
        return;
      }
      const delay = current.params.pollIntervalMs ?? 300_000;
      const timer = setTimeout(() => this.scheduleRun(id), delay);
      this.timers.set(id, timer);
    });
  }

  private async runOnce(id: string): Promise<void> {
    const def = this.instances.get(id);
    if (!def) {
      return;
    }
    const appendLog = (line: string) => this.appendLog(id, line);
    appendLog(`[${new Date().toISOString()}] Starting poll cycle...`);
    try {
      const cfg = buildConfig(def.params);
      const agent = new DevAgent(cfg, appendLog);
      await agent.run();
      appendLog(`[${new Date().toISOString()}] Poll cycle complete.`);
    } catch (err) {
      appendLog(`[${new Date().toISOString()}] [ERROR] ${String(err)}`);
    }
  }
}

// Module-level singleton; loaded lazily on first handler invocation.
export const devAgentManager = new DevAgentManager();

let managerLoaded = false;
export async function ensureManagerLoaded(): Promise<void> {
  if (managerLoaded) {
    return;
  }
  managerLoaded = true;
  await devAgentManager.load();
}
