import type { GatewayBrowserClient } from "../gateway.ts";

export type DevAgentParams = {
  pollIntervalMs?: number;
  behaviorMd?: string;
  jiraWorkflowMd?: string;
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

export type DevAgentStatus = "stopped" | "running" | "paused";

export type DevAgentInstance = {
  id: string;
  name: string;
  params: DevAgentParams;
  status: DevAgentStatus;
  createdAtMs: number;
};

export type DevAgentsListResult = {
  instances: DevAgentInstance[];
};

export type DevAgentLogEntry = {
  ts: number;
  line: string;
};

export type DevAgentsLogsResult = {
  id: string;
  logs: DevAgentLogEntry[];
};

export type DevAgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  devAgentsLoading: boolean;
  devAgentsError: string | null;
  devAgentsList: DevAgentInstance[] | null;
  devAgentsSelectedId: string | null;
  devAgentsLogs: Record<string, DevAgentLogEntry[]>;
  devAgentsLogsLoading: boolean;
  devAgentsBusy: boolean;
  devAgentsBusyId: string | null;
};

export async function loadDevAgents(state: DevAgentsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.devAgentsLoading) {
    return;
  }
  state.devAgentsLoading = true;
  state.devAgentsError = null;
  try {
    const res = await state.client.request<DevAgentsListResult>("dev-agents.list", {});
    if (res) {
      state.devAgentsList = res.instances;
      // Preserve selected id if still valid
      const ids = new Set(res.instances.map((i) => i.id));
      if (state.devAgentsSelectedId && !ids.has(state.devAgentsSelectedId)) {
        state.devAgentsSelectedId = res.instances[0]?.id ?? null;
      } else if (!state.devAgentsSelectedId && res.instances.length > 0) {
        state.devAgentsSelectedId = res.instances[0].id;
      }
    }
  } catch (err) {
    state.devAgentsError = String(err);
  } finally {
    state.devAgentsLoading = false;
  }
}

export async function loadDevAgentLogs(state: DevAgentsState, id: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.devAgentsLogsLoading = true;
  try {
    const res = await state.client.request<DevAgentsLogsResult>("dev-agents.logs", {
      id,
      limit: 200,
    });
    if (res) {
      state.devAgentsLogs = { ...state.devAgentsLogs, [id]: res.logs };
    }
  } catch {
    // ignore
  } finally {
    state.devAgentsLogsLoading = false;
  }
}

export async function createDevAgent(
  state: DevAgentsState,
  name: string,
  params: DevAgentParams,
): Promise<DevAgentInstance | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  state.devAgentsBusy = true;
  try {
    const res = await state.client.request<{ instance: DevAgentInstance }>("dev-agents.create", {
      name,
      params,
    });
    if (res?.instance) {
      state.devAgentsList = [...(state.devAgentsList ?? []), res.instance];
      state.devAgentsSelectedId = res.instance.id;
      return res.instance;
    }
    return null;
  } finally {
    state.devAgentsBusy = false;
  }
}

export async function updateDevAgent(
  state: DevAgentsState,
  id: string,
  updates: { name?: string; params?: DevAgentParams },
): Promise<DevAgentInstance | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  state.devAgentsBusy = true;
  state.devAgentsBusyId = id;
  try {
    const res = await state.client.request<{ instance: DevAgentInstance }>("dev-agents.update", {
      id,
      ...updates,
    });
    if (res?.instance) {
      state.devAgentsList = (state.devAgentsList ?? []).map((inst) =>
        inst.id === id ? res.instance : inst,
      );
      return res.instance;
    }
    return null;
  } finally {
    state.devAgentsBusy = false;
    state.devAgentsBusyId = null;
  }
}

export async function deleteDevAgent(state: DevAgentsState, id: string): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  state.devAgentsBusy = true;
  state.devAgentsBusyId = id;
  try {
    await state.client.request("dev-agents.delete", { id });
    state.devAgentsList = (state.devAgentsList ?? []).filter((inst) => inst.id !== id);
    if (state.devAgentsSelectedId === id) {
      state.devAgentsSelectedId = state.devAgentsList[0]?.id ?? null;
    }
    const next = { ...state.devAgentsLogs };
    delete next[id];
    state.devAgentsLogs = next;
    return true;
  } catch {
    return false;
  } finally {
    state.devAgentsBusy = false;
    state.devAgentsBusyId = null;
  }
}

export async function startDevAgent(state: DevAgentsState, id: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.devAgentsBusy = true;
  state.devAgentsBusyId = id;
  try {
    await state.client.request("dev-agents.start", { id });
    state.devAgentsList = (state.devAgentsList ?? []).map((inst) =>
      inst.id === id ? { ...inst, status: "running" as DevAgentStatus } : inst,
    );
  } finally {
    state.devAgentsBusy = false;
    state.devAgentsBusyId = null;
  }
}

export async function stopDevAgent(state: DevAgentsState, id: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.devAgentsBusy = true;
  state.devAgentsBusyId = id;
  try {
    await state.client.request("dev-agents.stop", { id });
    state.devAgentsList = (state.devAgentsList ?? []).map((inst) =>
      inst.id === id ? { ...inst, status: "stopped" as DevAgentStatus } : inst,
    );
  } finally {
    state.devAgentsBusy = false;
    state.devAgentsBusyId = null;
  }
}

export async function pauseDevAgent(state: DevAgentsState, id: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.devAgentsBusy = true;
  state.devAgentsBusyId = id;
  try {
    await state.client.request("dev-agents.pause", { id });
    state.devAgentsList = (state.devAgentsList ?? []).map((inst) =>
      inst.id === id ? { ...inst, status: "paused" as DevAgentStatus } : inst,
    );
  } finally {
    state.devAgentsBusy = false;
    state.devAgentsBusyId = null;
  }
}

export async function resumeDevAgent(state: DevAgentsState, id: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.devAgentsBusy = true;
  state.devAgentsBusyId = id;
  try {
    await state.client.request("dev-agents.resume", { id });
    state.devAgentsList = (state.devAgentsList ?? []).map((inst) =>
      inst.id === id ? { ...inst, status: "running" as DevAgentStatus } : inst,
    );
  } finally {
    state.devAgentsBusy = false;
    state.devAgentsBusyId = null;
  }
}
