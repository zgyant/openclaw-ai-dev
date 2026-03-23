import { loadDevAgentConfig } from "./config.js";
import { DevAgent } from "./dev-agent.js";

const cfg = loadDevAgentConfig();
const agent = new DevAgent(cfg);

async function loop(): Promise<void> {
  while (true) {
    await agent.run().catch((err) => console.error("❌ Agent run error:", err));
    await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs));
  }
}

loop().catch((err) => console.error("❌ Agent loop error:", err));
