import { join, dirname } from "node:path";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { createDomainAgent } from "@earendil-works/agent-base";

const dataDir = join(dirname(process.execPath), "data");
const debug = (msg: string) => {
  try { appendFileSync(join(dataDir, "debug.log"), `[sidecar] ${msg}\n`); } catch {}
};

const arg = (name: string) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};

const sessionFile = arg("--session");
const modelStr = arg("--model"); // "provider/modelId"
const allowTools = arg("--allow-tools")?.split(",");
const systemPrompt = arg("--system-prompt");

const [modelProvider, modelId] = modelStr ? modelStr.split("/") : [undefined, undefined];

debug(`model=${modelStr}`);

const agent = await createDomainAgent({
  dataDir,
  systemPrompt: systemPrompt ?? "You are a financial analysis assistant.",
  skillDirs: ["./skills"],
  allowTools,
  thinkingLevel: "medium",
  sessionFile,
  model: modelProvider && modelId ? { provider: modelProvider, id: modelId } as any : undefined,
});

await agent.runRpc();
