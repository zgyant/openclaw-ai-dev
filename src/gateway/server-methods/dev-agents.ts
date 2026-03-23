import {
  devAgentManager,
  ensureManagerLoaded,
  type DevAgentParams,
} from "../../agents/dev-agent/manager.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function parseParams(raw: unknown): DevAgentParams {
  const r = (raw ?? {}) as Record<string, unknown>;
  const jira = (r.jira ?? {}) as Record<string, unknown>;
  const bb = (r.bitbucket ?? {}) as Record<string, unknown>;
  const git = (r.git ?? {}) as Record<string, unknown>;
  return {
    pollIntervalMs:
      typeof r.pollIntervalMs === "number" && r.pollIntervalMs > 0 ? r.pollIntervalMs : undefined,
    jira: {
      host: isString(jira.host) ? jira.host : undefined,
      email: isString(jira.email) ? jira.email : undefined,
      apiToken: isString(jira.apiToken) ? jira.apiToken : undefined,
      projectKey: isString(jira.projectKey) ? jira.projectKey : undefined,
      maxTickets:
        typeof jira.maxTickets === "number" && jira.maxTickets > 0 ? jira.maxTickets : undefined,
    },
    bitbucket: {
      username: isString(bb.username) ? bb.username : undefined,
      appPassword: isString(bb.appPassword) ? bb.appPassword : undefined,
      workspace: isString(bb.workspace) ? bb.workspace : undefined,
      repo: isString(bb.repo) ? bb.repo : undefined,
      baseUrl: isString(bb.baseUrl) ? bb.baseUrl : undefined,
    },
    git: {
      defaultBranch: isString(git.defaultBranch) ? git.defaultBranch : undefined,
    },
  };
}

export const devAgentsHandlers: GatewayRequestHandlers = {
  "dev-agents.list": async ({ respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    respond(true, { instances: devAgentManager.list() });
  },

  "dev-agents.create": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const name = isString(raw.name) ? raw.name.trim() : "";
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name is required"));
      return;
    }
    const def = await devAgentManager.create({ name, params: parseParams(raw.params) });
    respond(true, { instance: def });
  },

  "dev-agents.update": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const updateParams: { name?: string; params?: DevAgentParams } = {};
    if (isString(raw.name)) {
      updateParams.name = raw.name;
    }
    if (raw.params !== undefined) {
      updateParams.params = parseParams(raw.params);
    }
    const updated = await devAgentManager.update(id, updateParams);
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "instance not found"));
      return;
    }
    respond(true, { instance: updated });
  },

  "dev-agents.delete": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const deleted = await devAgentManager.delete(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "instance not found"));
      return;
    }
    respond(true, { id });
  },

  "dev-agents.start": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const result = devAgentManager.start(id);
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "failed to start"),
      );
      return;
    }
    respond(true, { id, status: "running" });
  },

  "dev-agents.stop": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    devAgentManager.stop(id);
    respond(true, { id, status: "stopped" });
  },

  "dev-agents.pause": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const ok = devAgentManager.pause(id);
    if (!ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "instance is not running"));
      return;
    }
    respond(true, { id, status: "paused" });
  },

  "dev-agents.resume": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const result = devAgentManager.resume(id);
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error ?? "failed to resume"),
      );
      return;
    }
    respond(true, { id, status: "running" });
  },

  "dev-agents.logs": async ({ params, respond, context }) => {
    devAgentManager.setBroadcast(context.broadcast);
    await ensureManagerLoaded();
    const raw = params;
    const id = isString(raw.id) ? raw.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const limit = typeof raw.limit === "number" ? raw.limit : 200;
    const logs = devAgentManager.getLogs(id, limit);
    respond(true, { id, logs });
  },
};
