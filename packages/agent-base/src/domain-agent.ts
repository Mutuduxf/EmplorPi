/**
 * Domain Agent Runtime — convenience layer for building portable domain agents.
 *
 * Usage:
 * ```typescript
 * import { createDomainAgent } from "@earendil-works/agent-base";
 * import { MyDomainTools } from "./tools/domain-tools.ts";
 *
 * const agent = await createDomainAgent({
 *   tools: [MyDomainTools],
 *   skillDirs: ["./skills"],
 *   systemPrompt: "You are a finance assistant...",
 * });
 * await agent.runRpc();
 * ```
 *
 * What it does internally:
 * 1. Loads skills from skillDirs
 * 2. Creates AuthStorage, ModelRegistry, SettingsManager, SessionManager
 * 3. Creates Agent + AgentSession with domain tools (no coding tools)
 * 4. Builds system prompt from skills + user prompt
 * 5. Wraps everything in an AgentSessionRuntime
 */

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { isBunBinary } from "./config.ts";
import type { AgentSession } from "./core/agent-session.ts";
import type { AgentSessionRuntime, CreateAgentSessionRuntimeFactory } from "./core/agent-session-runtime.ts";
import { createAgentSessionRuntime } from "./core/agent-session-runtime.ts";
import type { AgentSessionServices } from "./core/agent-session-services.ts";
import { createAgentSessionFromServices } from "./core/agent-session-services.ts";
import { AuthStorage } from "./core/auth-storage.ts";
import { createExtensionRuntime } from "./core/extensions/loader.ts";
import type { LoadExtensionsResult, ToolDefinition } from "./core/extensions/types.ts";
import { ModelRegistry } from "./core/model-registry.ts";
import type { ResourceDiagnostic, ResourceExtensionPaths, ResourceLoader } from "./core/resource-loader.ts";
import { SessionManager } from "./core/session-manager.ts";
import { SettingsManager } from "./core/settings-manager.ts";
import { loadSkillsFromDir, type Skill } from "./core/skills.ts";
import { InteractiveMode } from "./modes/interactive/interactive-mode.ts";
import { runPrintMode } from "./modes/print-mode.ts";
import { runRpcMode } from "./modes/rpc/rpc-mode.ts";

// ============================================================================
// Types
// ============================================================================

export interface DomainAgentOptions {
	/** Data directory for sessions, settings, auth. Default: cwd + "/data" */
	dataDir?: string;

	/** Domain-specific tools to register. */
	tools?: ToolDefinition[];

	/** Directories to load .md skill files from. Skills are injected into system prompt. */
	skillDirs?: string[];

	/**
	 * Custom identity prompt for the agent.
	 * If omitted, uses the default generic prompt ("You are an AI assistant").
	 */
	systemPrompt?: string;

	/** Additional text appended to the end of the system prompt. */
	appendSystemPrompt?: string;

	/** Model to use. Auto-detected from env vars if omitted. */
	model?: Model<any>;

	/** Thinking level for the model. */
	thinkingLevel?: ThinkingLevel;

	/** Models available for cycling (Ctrl+P in interactive/TUI mode). */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	/**
	 * Whether to exclude the default coding tools (read, write, bash, edit).
	 * Default: true (domain agents typically don't need coding tools).
	 */
	excludeDefaultTools?: boolean;

	/** Working directory. Default: process.cwd() */
	cwd?: string;

	/** API key override. Sets a runtime key for the selected model's provider. */
	apiKey?: string;
}

// ============================================================================
// DomainResourceLoader — loads skills from directories, nothing else
// ============================================================================

class DomainResourceLoader implements ResourceLoader {
	private _skills: Skill[] = [];
	private _diagnostics: ResourceDiagnostic[] = [];
	private _extensionsResult: LoadExtensionsResult;
	private _systemPrompt?: string;
	private _appendSystemPrompt?: string;
	private _skillDirs: string[];

	constructor(options: {
		skillDirs?: string[];
		systemPrompt?: string;
		appendSystemPrompt?: string;
	}) {
		this._skillDirs = options.skillDirs ?? [];
		this._systemPrompt = options.systemPrompt;
		this._appendSystemPrompt = options.appendSystemPrompt;
		this._extensionsResult = {
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		};
	}

	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: this._skills, diagnostics: this._diagnostics };
	}

	getExtensions(): LoadExtensionsResult {
		return this._extensionsResult;
	}

	getPrompts() {
		return { prompts: [] as any[], diagnostics: [] as ResourceDiagnostic[] };
	}

	getThemes() {
		return { themes: [] as any[], diagnostics: [] as ResourceDiagnostic[] };
	}

	getAgentsFiles() {
		return { agentsFiles: [] as Array<{ path: string; content: string }> };
	}

	getSystemPrompt(): string | undefined {
		return this._systemPrompt;
	}

	getAppendSystemPrompt(): string[] {
		return this._appendSystemPrompt ? [this._appendSystemPrompt] : [];
	}

	extendResources(_paths: ResourceExtensionPaths): void {
		// No-op — domain agents don't use project resource paths
	}

	async reload(): Promise<void> {
		this._skills = [];
		this._diagnostics = [];

		for (const dir of this._skillDirs) {
			if (!existsSync(dir)) {
				this._diagnostics.push({
					type: "warning" as const,
					message: `Skill directory does not exist: ${dir}`,
					path: dir,
				});
				continue;
			}
			const result = loadSkillsFromDir({ dir, source: "path" });
			this._skills.push(...result.skills);
			this._diagnostics.push(...result.diagnostics);
		}
	}
}

// ============================================================================
// DomainAgentRuntime
// ============================================================================

/**
 * Portable domain agent runtime.
 *
 * Wraps AgentSessionRuntime with convenient run mode methods.
 * Use {@link createDomainAgent} to construct instances.
 */
export class DomainAgentRuntime {
	private _runtime: AgentSessionRuntime;

	/** @internal Use createDomainAgent() to create this class. */
	constructor(runtime: AgentSessionRuntime) {
		this._runtime = runtime;
	}

	/** Underlying AgentSessionRuntime (for advanced access). */
	get runtime(): AgentSessionRuntime {
		return this._runtime;
	}

	/** The active AgentSession. */
	get session(): AgentSession {
		return this._runtime.session;
	}

	/**
	 * Run in RPC mode (JSON lines over stdin/stdout).
	 *
	 * This is the primary mode for Tauri sidecar usage:
	 * - Reads JSON commands from stdin (prompt, steer, abort, etc.)
	 * - Writes JSON events and responses to stdout (message updates, tool results)
	 *
	 * Never returns — the process runs until it receives a shutdown command.
	 */
	async runRpc(): Promise<never> {
		return runRpcMode(this._runtime);
	}

	/**
	 * Run in print mode — send a single prompt and print the response.
	 * Returns the exit code (0 = success, 1 = error).
	 */
	async runPrint(input: string): Promise<number> {
		return runPrintMode(this._runtime, { mode: "text", initialMessage: input });
	}

	/**
	 * Run in interactive TUI mode (full-screen terminal UI).
	 * Requires a real terminal. Not suitable for Tauri sidecar usage.
	 */
	async runInteractive(): Promise<void> {
		const mode = new InteractiveMode(this._runtime);
		await mode.run();
	}

	/** Dispose the runtime (cleanup, kill child processes). */
	async dispose(): Promise<void> {
		await this._runtime.dispose();
	}
}

// ============================================================================
// Helpers
// ============================================================================

function resolveDataDir(dataDir?: string): string {
	if (dataDir) return dataDir;
	if (isBunBinary) {
		// Portable: data directory next to the executable
		try {
			return join(dirname(realpathSync(process.execPath)), "data");
		} catch {
			return join(process.cwd(), "data");
		}
	}
	return join(process.cwd(), "data");
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a DomainAgentRuntime.
 *
 * This is the main entry point for building domain agents.
 * It wires up auth, settings, model registry, skills, tools, and session in one call.
 *
 * @example
 * ```typescript
 * import { createDomainAgent } from "@earendil-works/agent-base";
 *
 * const agent = await createDomainAgent({
 *   tools: [myTool],
 *   skillDirs: ["./skills"],
 *   systemPrompt: "You are a finance assistant.",
 * });
 * await agent.runRpc();
 * ```
 */
export async function createDomainAgent(options: DomainAgentOptions = {}): Promise<DomainAgentRuntime> {
	const cwd = options.cwd ?? process.cwd();
	const dataDir = resolveDataDir(options.dataDir);
	const excludeDefaultTools = options.excludeDefaultTools ?? true;

	// Ensure data directories exist
	mkdirSync(join(dataDir, "sessions"), { recursive: true });

	// 1. Create auth storage
	const authStorage = AuthStorage.create(join(dataDir, "auth.json"));

	// 2. Create model registry
	const modelRegistry = ModelRegistry.create(authStorage, join(dataDir, "models.json"));

	// 3. Create settings manager
	const settingsManager = SettingsManager.create(cwd, dataDir);

	// 4. Create resource loader (loads skills, returns empty for everything else)
	const resourceLoader = new DomainResourceLoader({
		skillDirs: options.skillDirs,
		systemPrompt: options.systemPrompt,
		appendSystemPrompt: options.appendSystemPrompt,
	});
	await resourceLoader.reload();

	// 5. Create the runtime factory (reused for session switch/fork)
	const factory: CreateAgentSessionRuntimeFactory = async (opts) => {
		const services: AgentSessionServices = {
			cwd: opts.cwd,
			agentDir: opts.agentDir,
			authStorage,
			settingsManager,
			modelRegistry,
			resourceLoader,
			diagnostics: [],
		};

		const result = await createAgentSessionFromServices({
			services,
			sessionManager: opts.sessionManager,
			sessionStartEvent: opts.sessionStartEvent,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			scopedModels: options.scopedModels,
			noTools: excludeDefaultTools ? "all" : undefined,
			customTools: options.tools,
		});

		if (options.apiKey && result.session.model) {
			authStorage.setRuntimeApiKey(result.session.model.provider, options.apiKey);
		}

		return {
			...result,
			services,
			diagnostics: services.diagnostics,
		};
	};

	// 6. Create initial session manager
	const sessionManager = SessionManager.create(cwd, join(dataDir, "sessions"));

	// 7. Create the runtime
	const runtime = await createAgentSessionRuntime(factory, {
		cwd,
		agentDir: dataDir,
		sessionManager,
	});

	return new DomainAgentRuntime(runtime);
}
