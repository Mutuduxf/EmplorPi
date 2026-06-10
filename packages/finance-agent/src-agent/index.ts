import { join, dirname } from "node:path";
import { appendFileSync } from "node:fs";
import { createDomainAgent } from "@earendil-works/agent-base";
import { getModel } from "@earendil-works/pi-ai";

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

let model;
if (modelStr) {
  const [provider, modelId] = modelStr.split("/");
  try {
    model = getModel(provider, modelId);
    debug(`model resolved: ${model.provider}/${model.id}`);
  } catch (e) {
    debug(`model not found: ${provider}/${modelId}, will auto-detect`);
    model = undefined;
  }
}

const agent = await createDomainAgent({
  dataDir,
  systemPrompt: systemPrompt ?? "You are a financial analysis assistant.",
  skillDirs: ["./skills"],
  allowTools,
  thinkingLevel: "medium",
  sessionFile,
  model,
});

await agent.runRpc();
