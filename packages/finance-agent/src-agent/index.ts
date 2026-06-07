/**
 * Finance Agent — RPC sidecar entry point.
 *
 * Supports two modes:
 *   tsx src-agent/index.ts           → interactive (stdin readline loop)
 *   tsx src-agent/index.ts --rpc     → RPC mode (JSON lines for Tauri)
 *   tsx src-agent/index.ts --print "question" → single-shot print
 */

import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AgentSession,
  AuthStorage,
  InMemoryAuthStorageBackend,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  runPrintMode,
  runRpcMode,
} from "@earendil-works/agent-base";
import { FinanceTools } from "./tools/domain-tools.ts";

async function main() {
  const dataDir = process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), "data");
  const mode = process.argv[2]; // --rpc, --print, or undefined

  const auth = new AuthStorage(new InMemoryAuthStorageBackend());

  // Try loading API key from environment
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    auth.setApiKey(apiKey.includes("sk-ant") ? "anthropic" : "openai", apiKey);
  }

  const agent = new Agent({});
  const session = new AgentSession({
    agent,
    sessionManager: SessionManager.create(dataDir, join(dataDir, "sessions"), true),
    settingsManager: SettingsManager.create(dataDir, dataDir),
    cwd: dataDir,
    toolExecutor: new FinanceTools(),
    modelRegistry: ModelRegistry.create(auth, join(dataDir, "models.json")),
  });

  if (mode === "--rpc") {
    await runRpcMode(session);
  } else if (mode === "--print") {
    const question = process.argv.slice(3).join(" ");
    if (!question) {
      console.error("Usage: tsx src-agent/index.ts --print \"your question\"");
      process.exit(1);
    }
    const code = await runPrintMode(session, { mode: "text", initialMessage: question });
    process.exit(code);
  } else {
    // Interactive readline mode for development
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log("Finance Agent ready. Type your question (Ctrl+C to exit):\n");

    session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") process.stdout.write(block.text + "\n\n");
        }
        rl.prompt();
      }
    });

    const ask = () => {
      rl.question("> ", async (input) => {
        if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
          session.dispose();
          rl.close();
          return;
        }
        try { await session.prompt(input); } catch (e) { console.error("Error:", e); rl.prompt(); }
      });
    };
    ask();
  }
}

main().catch(console.error);
