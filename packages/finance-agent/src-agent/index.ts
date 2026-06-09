import { join, dirname } from "node:path";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
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

const sessionFileArg = arg("--session");
debug(`sessionFile=${sessionFileArg}`);
if (sessionFileArg) debug(`file exists: ${existsSync(sessionFileArg)}`);

const sessionsDir = join(dataDir, "sessions");

const allowTools = arg("--allow-tools")?.split(",");
const systemPrompt = arg("--system-prompt");

const agent = await createDomainAgent({
  dataDir,
  systemPrompt: systemPrompt ?? "You are a financial analysis assistant.",
  skillDirs: ["./skills"],
  allowTools,
  thinkingLevel: "medium",
  sessionFile: sessionFileArg,
});

// Check session file after createDomainAgent
const filesAfterCreate = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl")).sort();
debug(`files after createDomainAgent: [${filesAfterCreate.join(", ")}]`);

// Check the agent's session file path
let sessionFilePath: string | undefined;
try {
  const getSessionFile = agent.session.sessionManager.getSessionFile;
  if (getSessionFile) {
    // @ts-expect-error
    sessionFilePath = getSessionFile();
    debug(`session.sessionFile=${sessionFilePath}`);
  }
} catch (e) {
  debug(`error getting sessionFile: ${e}`);
}

// Add a periodic check using setInterval to see if session file changes
const checkInterval = setInterval(() => {
  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl")).sort();
  debug(`files check: [${files.join(", ")}]`);
}, 1000);

await agent.runRpc();

clearInterval(checkInterval);
debug("RPC mode ended");
