/**
 * Agent sidecar — portable desktop agent process.
 *
 * Communicates with the Tauri frontend via RPC over stdin/stdout.
 * All data is stored alongside the executable (portable).
 */

import { join, dirname } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AgentSession,
  AuthStorage,
  FileAuthStorageBackend,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  runRpcMode,
} from "@earendil-works/agent-base";
import { MyDomainTools } from "./tools/domain-tools.ts";

// Portable: data directory lives next to the executable
const exeDir = dirname(process.execPath);
const dataDir = join(exeDir, "data");

process.env.PI_CODING_AGENT_DIR = dataDir;

const agent = new Agent({});

const auth = new AuthStorage(new FileAuthStorageBackend());
const session = new AgentSession({
  agent,
  sessionManager: SessionManager.create(dataDir, join(dataDir, "sessions"), true),
  settingsManager: SettingsManager.create(dataDir, dataDir),
  cwd: dataDir,
  toolExecutor: new MyDomainTools(),
  modelRegistry: ModelRegistry.create(auth, join(dataDir, "models.json")),
});

await runRpcMode(session);
