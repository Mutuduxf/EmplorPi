/**
 * Finance Agent — RPC sidecar entry point.
 */

import { join, dirname } from "node:path";
import { createDomainAgent } from "@earendil-works/agent-base";
import { webSearchTool } from "./tools/web-search.ts";

const dataDir = join(dirname(process.execPath), "data");

// Parse arguments
const arg = (name: string) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};

const sessionFile = arg("--session");
const allowTools = arg("--allow-tools")?.split(",");
const systemPrompt = arg("--system-prompt");

const agent = await createDomainAgent({
  dataDir,
  systemPrompt: systemPrompt ?? "You are a financial analysis assistant. You help users with financial data analysis, report generation, and market insights. When the user references a file path, use the read tool to examine it.",
  tools: [webSearchTool],
  skillDirs: ["./skills"],
  allowTools,
  thinkingLevel: "medium",
  sessionFile,
});

await agent.runRpc();
