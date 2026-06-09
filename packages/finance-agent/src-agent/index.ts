import { join, dirname } from "node:path";
import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { createDomainAgent } from "@earendil-works/agent-base";

const dataDir = join(dirname(process.execPath), "data");
const debug = (msg: string) => {
  try { appendFileSync(join(dataDir, "debug.log"), `[sidecar] ${msg}\n`); } catch {}
};

debug(`argv: ${process.argv.slice(2).join(" ")}`);

const arg = (name: string) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
};

const sessionFile = arg("--session");
debug(`sessionFile=${sessionFile}`);

if (sessionFile) {
  debug(`file exists: ${existsSync(sessionFile)}`);
}

const allowTools = arg("--allow-tools")?.split(",");
const systemPrompt = arg("--system-prompt");

const agent = await createDomainAgent({
  dataDir,
  systemPrompt: systemPrompt ?? "You are a financial analysis assistant.",
  skillDirs: ["./skills"],
  allowTools,
  thinkingLevel: "medium",
  sessionFile,
});

debug("createDomainAgent done, entering RPC mode");
await agent.runRpc();
