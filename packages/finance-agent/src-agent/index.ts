/**
 * Finance Agent — RPC sidecar entry point.
 *
 * Built with @earendil-works/agent-base's createDomainAgent.
 */

import { join, dirname } from "node:path";
import { createDomainAgent } from "@earendil-works/agent-base";

const dataDir = join(dirname(process.execPath), "data");

const agent = await createDomainAgent({
  dataDir,
  systemPrompt:
    "You are a financial analysis assistant. You help users with " +
    "financial data analysis, report generation, and market insights.",
  skillDirs: ["./skills"],
  excludeDefaultTools: true,
  thinkingLevel: "off",
});

await agent.runRpc();
