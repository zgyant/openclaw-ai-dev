import axios from "axios";
import type { DevAgentConfig } from "../config.js";

export async function createPR(
  cfg: DevAgentConfig["bitbucket"],
  defaultBranch: string,
  branch: string,
  ticket: { key: string; summary: string },
) {
  const bb = axios.create({
    baseURL: cfg.baseUrl,
    auth: { username: cfg.username, password: cfg.appPassword },
  });

  const res = await bb.post(`/repositories/${cfg.workspace}/${cfg.repo}/pullrequests`, {
    title: `${ticket.key}: ${ticket.summary}`,
    source: { branch: { name: branch } },
    destination: { branch: { name: defaultBranch } },
    description: `Auto-generated PR for ${ticket.key}`,
  });

  return res.data;
}
