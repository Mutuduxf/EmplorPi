/**
 * Finance Agent — RPC sidecar entry point.
 *
 * Built with @earendil-works/agent-base's createDomainAgent.
 * Supports --session <path> to resume an existing conversation.
 */

import { join, dirname } from "node:path";
import { createDomainAgent } from "@earendil-works/agent-base";

const dataDir = join(dirname(process.execPath), "data");

// Parse --session argument
const sessionIdx = process.argv.indexOf("--session");
const sessionFile = sessionIdx >= 0 ? process.argv[sessionIdx + 1] : undefined;

const agent = await createDomainAgent({
  dataDir,
  systemPrompt:
    "You are a financial analysis assistant. You help users with " +
    "financial data analysis, report generation, and market insights.",
  skillDirs: ["./skills"],
  excludeDefaultTools: true,
  thinkingLevel: "medium",
  sessionFile,
});

await agent.runRpc();
