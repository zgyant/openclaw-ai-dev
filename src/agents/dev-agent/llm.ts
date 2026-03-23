import type { OpenClawPluginApi } from "openclaw/plugin-sdk/llm-task";
import { createLlmTaskTool } from "../../../extensions/llm-task/src/llm-task-tool.js";
import { loadConfig } from "../../config/io.js";

const cfg = loadConfig();

// Minimal API surface that createLlmTaskTool actually accesses at runtime.
const api: OpenClawPluginApi = {
  id: "dev-agent",
  name: "dev-agent",
  source: "local",
  registrationMode: "full",
  pluginConfig: {},
  config: {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        workspace: process.cwd(),
      },
    },
  },
  runtime: {
    agent: { runEmbeddedPiAgent: async () => ({ payloads: [] }) },
  } as unknown as OpenClawPluginApi["runtime"],
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  registerTool() {},
  registerHook() {},
  registerHttpRoute() {},
  registerChannel() {},
  registerGatewayMethod() {},
  registerCli() {},
  registerService() {},
  registerProvider() {},
  registerSpeechProvider() {},
  registerMediaUnderstandingProvider() {},
  registerImageGenerationProvider() {},
  registerWebSearchProvider() {},
  registerInteractiveHandler() {},
  onConversationBindingResolved() {},
  registerCommand() {},
  registerContextEngine() {},
  resolvePath: (p) => p,
  on() {},
};

export const llmTask = createLlmTaskTool(api);

export async function planner(prompt: string, schema?: unknown): Promise<unknown> {
  const res = await llmTask.execute("planner", { prompt, schema, thinking: "high" });
  return JSON.parse(res.content[0].text);
}

export async function coder(prompt: string, schema?: unknown): Promise<unknown> {
  const res = await llmTask.execute("coder", { prompt, schema, thinking: "high" });
  return JSON.parse(res.content[0].text);
}
