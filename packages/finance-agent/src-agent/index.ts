/**
 * Finance Agent — RPC sidecar entry point.
 *
 * Built with @earendil-works/agent-base's createDomainAgent.
 * Supports --session <path> to resume an existing conversation.
 * Supports --allow-tools <name> to enable specific built-in tools.
 */

import { join, dirname } from "node:path";
import { createDomainAgent } from "@earendil-works/agent-base";

const dataDir = join(dirname(process.execPath), "data");

// Parse --session argument
const sessionIdx = process.argv.indexOf("--session");
const sessionFile = sessionIdx >= 0 ? process.argv[sessionIdx + 1] : undefined;

// Parse --allow-tools argument (comma-separated: "read,grep")
const toolsIdx = process.argv.indexOf("--allow-tools");
const allowTools = toolsIdx >= 0 ? process.argv[toolsIdx + 1].split(",") : undefined;

const agent = await createDomainAgent({
  dataDir,
  systemPrompt:
    "You are a financial analysis assistant. You help users with " +
    "financial data analysis, report generation, and market insights. " +
    "When the user references a file path, use the read tool to examine it.",
  skillDirs: ["./skills"],
  allowTools,
  thinkingLevel: "medium",
  sessionFile,
});

await agent.runRpc();
