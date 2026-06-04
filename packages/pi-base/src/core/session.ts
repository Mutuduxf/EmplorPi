/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * Generic version extracted from @earendil-works/pi-coding-agent.
 * Tool execution is delegated to a ToolExecutor interface, making this
 * usable by agents that don't need file/bash/edit tools.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type {
	Agent,
	AgentEvent,
	AgentMessage,
	AgentState,
	AgentTool,
	ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { clampThinkingLevel, cleanupSessionResources, modelsAreEqual, streamSimple } from "@earendil-works/pi-ai";
import { formatNoModelSelectedMessage } from "./auth-guidance.ts";
import type { CompactionResult } from "./compaction/compaction.ts";
import { compact, prepareCompaction } from "./compaction/index.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type {
	ExtensionCommandContextActions,
	ExtensionErrorListener,
	ExtensionMode,
	ExtensionUIContext,
	InputSource,
	SessionStartEvent,
	ShutdownHandler,
	ToolDefinition,
	ToolInfo,
} from "./extensions/index.ts";
import { ExtensionRunner } from "./extensions/index.ts";
import type { CustomMessage } from "./messages.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { expandPromptTemplate, type PromptTemplate } from "./prompt-templates.ts";
import type { SessionManager } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";
import { type BuildSystemPromptOptions, buildSystemPrompt } from "./system-prompt.ts";
import type { ToolExecutor } from "./tools/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
	const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
	if (!match) return null;
	return { name: match[1]!, location: match[2]!, content: match[3]!, userMessage: match[4]?.trim() || undefined };
}

export type AgentSessionEvent =
	| Exclude<AgentEvent, { type: "agent_end" }>
	| { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
	| { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "session_info_changed"; name: string | undefined }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cwd: string;
	toolExecutor: ToolExecutor;
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	customTools?: ToolDefinition[];
	modelRegistry: ModelRegistry;
	initialActiveToolNames?: string[];
	allowedToolNames?: string[];
	excludedToolNames?: string[];
	extensionRunnerRef?: { current?: ExtensionRunner };
	sessionStartEvent?: SessionStartEvent;
}

export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	mode?: ExtensionMode;
	commandContextActions?: ExtensionCommandContextActions;
	abortHandler?: () => void;
	shutdownHandler?: ShutdownHandler;
	onError?: ExtensionErrorListener;
}

export interface PromptOptions {
	expandPromptTemplates?: boolean;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";
	source?: InputSource;
	preflightResult?: (success: boolean) => void;
}

export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	isScoped: boolean;
}

export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
}

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private _scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];
	private _steeringMessages: string[] = [];
	private _followUpMessages: string[] = [];
	private _pendingNextTurnMessages: CustomMessage[] = [];
	private _compactionAbortController: AbortController | undefined;
	private _autoCompactionAbortController: AbortController | undefined;
	private _branchSummaryAbortController: AbortController | undefined;
	private _retryAttempt = 0;
	private _extensionRunner!: ExtensionRunner;
	private _customTools: ToolDefinition[];
	private _cwd: string;
	private _extensionRunnerRef?: { current?: ExtensionRunner };
	private _initialActiveToolNames?: string[];
	private _allowedToolNames?: Set<string>;
	private _excludedToolNames?: Set<string>;
	private _sessionStartEvent: SessionStartEvent;
	private _modelRegistry: ModelRegistry;
	private _toolRegistry: Map<string, AgentTool> = new Map();
	private _toolDefinitions: Map<string, { definition: ToolDefinition; sourceInfo: SourceInfo }> = new Map();
	private _toolPromptSnippets: Map<string, string> = new Map();
	private _toolPromptGuidelines: Map<string, string[]> = new Map();
	private _toolExecutor: ToolExecutor;
	private _baseSystemPrompt = "";
	private _baseSystemPromptOptions!: BuildSystemPromptOptions;

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._scopedModels = config.scopedModels ?? [];
		this._customTools = config.customTools ?? [];
		this._cwd = config.cwd;
		this._modelRegistry = config.modelRegistry;
		this._extensionRunnerRef = config.extensionRunnerRef;
		this._initialActiveToolNames = config.initialActiveToolNames;
		this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
		this._excludedToolNames = config.excludedToolNames ? new Set(config.excludedToolNames) : undefined;
		this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
		this._toolExecutor = config.toolExecutor;
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		this._buildRuntime({ activeToolNames: this._initialActiveToolNames, includeAllExtensionTools: true });
	}

	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);
		return () => {
			const i = this._eventListeners.indexOf(listener);
			if (i !== -1) this._eventListeners.splice(i, 1);
		};
	}

	dispose(): void {
		try {
			this.agent.abort();
		} catch {}
		this._disconnectFromAgent();
		this._eventListeners = [];
		cleanupSessionResources(this.sessionId);
	}

	private _emit(event: AgentSessionEvent): void {
		for (const l of this._eventListeners) l(event);
	}

	private _emitQueueUpdate(): void {
		this._emit({
			type: "queue_update",
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		});
	}

	private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		if (event.type === "message_start" && event.message.role === "user") {
			this._overflowRecoveryAttempted = false;
		}
		await this._extensionRunner.emit(event);
		this._emit(event.type === "agent_end" ? { ...event, willRetry: this._willRetryAfterAgentEnd(event) } : event);
		if (
			event.type === "message_end" &&
			(event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult")
		) {
			this.sessionManager.appendMessage(event.message);
			if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;
			}
		}
	};

	// =========================================================================
	// State Access
	// =========================================================================

	get state(): AgentState {
		return this.agent.state;
	}
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}
	get retryAttempt(): number {
		return this._retryAttempt;
	}
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}
	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> {
		return this._scopedModels;
	}
	get isCompacting(): boolean {
		return !!this._compactionAbortController || !!this._autoCompactionAbortController;
	}
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}
	get pendingMessageCount(): number {
		return this._steeringMessages.length + this._followUpMessages.length;
	}
	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return [];
	}

	getActiveToolNames(): string[] {
		return this.agent.state.tools.map((t) => t.name);
	}

	getAllTools(): ToolInfo[] {
		return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
			name: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			promptGuidelines: definition.promptGuidelines,
			sourceInfo,
		}));
	}

	setScopedModels(models: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		this._scopedModels = models;
	}

	setActiveToolsByName(toolNames: string[]): void {
		const tools: AgentTool[] = [];
		const validNames: string[] = [];
		for (const name of toolNames) {
			const t = this._toolRegistry.get(name);
			if (t) {
				tools.push(t);
				validNames.push(name);
			}
		}
		this.agent.state.tools = tools;
		this._baseSystemPrompt = this._rebuildSystemPrompt(validNames);
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this._toolDefinitions.get(name)?.definition;
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	async prompt(text: string, options?: PromptOptions): Promise<void> {
		const expandPromptTemplates = options?.expandPromptTemplates ?? true;
		const preflight = options?.preflightResult;

		if (this.isStreaming) {
			if (!options?.streamingBehavior) throw new Error("Agent is processing. Specify streamingBehavior.");
			if (options.streamingBehavior === "followUp") {
				await this._queueFollowUp(text, options.images);
			} else {
				await this._queueSteer(text, options.images);
			}
			preflight?.(true);
			return;
		}

		let currentText = text;
		let currentImages = options?.images;
		if (expandPromptTemplates && text.startsWith("/")) {
			const handled = await this._tryExtensionCommand(text);
			if (handled) {
				preflight?.(true);
				return;
			}
		}
		if (this._extensionRunner.hasHandlers("input")) {
			const result = await this._extensionRunner.emitInput(
				currentText,
				currentImages,
				options?.source ?? "interactive",
			);
			if (result.action === "handled") {
				preflight?.(true);
				return;
			}
			if (result.action === "transform") {
				currentText = result.text ?? currentText;
				currentImages = result.images ?? currentImages;
			}
		}
		if (expandPromptTemplates) {
			currentText = this._expandSkillCommand(currentText);
			currentText = expandPromptTemplate(currentText, [...this.promptTemplates]);
		}
		if (!this.model) throw new Error(formatNoModelSelectedMessage());

		const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: currentText }];
		if (currentImages) userContent.push(...currentImages);

		const msgs: AgentMessage[] = [{ role: "user", content: userContent, timestamp: Date.now() }];
		for (const m of this._pendingNextTurnMessages) msgs.push(m);
		this._pendingNextTurnMessages = [];

		const extResult = await this._extensionRunner.emitBeforeAgentStart(
			currentText,
			currentImages,
			this._baseSystemPrompt,
			this._baseSystemPromptOptions,
		);
		if (extResult?.message) {
			msgs.push({
				role: "custom",
				customType: extResult.message.customType,
				content: extResult.message.content,
				display: extResult.message.display,
				details: extResult.message.details,
				timestamp: Date.now(),
			} as any);
		}
		this.agent.state.systemPrompt = extResult?.systemPrompt ?? this._baseSystemPrompt;

		preflight?.(true);
		await this._runAgentPrompt(msgs);
	}

	async steer(text: string, images?: ImageContent[]): Promise<void> {
		let t = this._expandSkillCommand(text);
		t = expandPromptTemplate(t, [...this.promptTemplates]);
		await this._queueSteer(t, images);
	}

	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		let t = this._expandSkillCommand(text);
		t = expandPromptTemplate(t, [...this.promptTemplates]);
		await this._queueFollowUp(t, images);
	}

	private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
		this._steeringMessages.push(text);
		this._emitQueueUpdate();
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images) content.push(...images);
		this.agent.steer({ role: "user", content, timestamp: Date.now() });
	}

	private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
		this._followUpMessages.push(text);
		this._emitQueueUpdate();
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images) content.push(...images);
		this.agent.followUp({ role: "user", content, timestamp: Date.now() });
	}

	async abort(): Promise<void> {
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	async setModel(model: Model<any>): Promise<void> {
		this.agent.state.model = model;
		this.sessionManager.appendModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length > 0) {
			const filtered = this._scopedModels.filter((s) => this._modelRegistry.hasConfiguredAuth(s.model));
			if (filtered.length <= 1) return undefined;
			const curIdx = filtered.findIndex((s) => modelsAreEqual(s.model, this.model));
			const nextIdx =
				direction === "forward" ? (curIdx + 1) % filtered.length : (curIdx - 1 + filtered.length) % filtered.length;
			const next = filtered[nextIdx]!;
			this.agent.state.model = next.model;
			this.sessionManager.appendModelChange(next.model.provider, next.model.id);
			this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
			return { model: next.model, thinkingLevel: next.thinkingLevel ?? "off", isScoped: true };
		}
		const available = await this._modelRegistry.getAvailable();
		if (available.length <= 1) return undefined;
		const curIdx = available.findIndex((m) => modelsAreEqual(m, this.model));
		const nextIdx =
			direction === "forward" ? (curIdx + 1) % available.length : (curIdx - 1 + available.length) % available.length;
		this.agent.state.model = available[nextIdx]!;
		this.sessionManager.appendModelChange(this.agent.state.model.provider, this.agent.state.model.id);
		this.settingsManager.setDefaultModelAndProvider(this.agent.state.model.provider, this.agent.state.model.id);
		return { model: this.agent.state.model, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	setThinkingLevel(level: ThinkingLevel): void {
		if (!this.model) return;
		const clamped = clampThinkingLevel(this.model, level);
		this.agent.state.thinkingLevel = clamped;
		this._emit({ type: "thinking_level_changed", level: clamped });
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	async compact(reason: "manual" | "threshold" | "overflow" = "manual"): Promise<void> {
		if (this.isCompacting) return;
		await this._autoCompact(reason);
	}

	abortCompaction(): void {
		this._compactionAbortController?.abort();
		this._compactionAbortController = undefined;
		this._autoCompactionAbortController = undefined;
	}

	abortBranchSummary(): void {
		this._branchSummaryAbortController?.abort();
		this._branchSummaryAbortController = undefined;
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	newSession(sessionId: string): void {
		this.sessionManager.newSession({ id: sessionId });
		this.agent.state.model = undefined as any;
		this.agent.state.messages = [];
		this.agent.state.tools = [];
		this.agent.state.systemPrompt = "";
		this.agent.state.thinkingLevel = DEFAULT_THINKING_LEVEL;
	}

	private async _autoCompact(reason: "manual" | "threshold" | "overflow"): Promise<void> {
		const ctrl = new AbortController();
		this._compactionAbortController = ctrl;
		this._autoCompactionAbortController = ctrl;
		this._emit({ type: "compaction_start", reason });
		try {
			const model = this.model;
			if (!model) return;
			const auth = await this._getCompactionRequestAuth(model);
			const settings = this.settingsManager.getCompactionSettings();
			const _fileOps = {
				readFile: async (p: string) => readFileSync(p, "utf-8"),
				writeFile: async (p: string, c: string) => writeFileSync(p, c, "utf-8"),
				mkdir: async (p: string) => mkdirSync(p, { recursive: true }),
				exists: async (p: string) => existsSync(p),
			};
			const entries = this.sessionManager.getEntries();
			const prep = entries ? prepareCompaction(entries, settings as any) : undefined;
			if (prep) {
				await compact(prep, model, auth.apiKey, auth.headers, undefined, ctrl.signal);
			}
			this._emit({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: ctrl.signal.aborted,
				willRetry: false,
			});
		} catch (err) {
			this._emit({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage: String(err),
			});
		} finally {
			this._compactionAbortController = undefined;
			this._autoCompactionAbortController = undefined;
		}
	}

	private async _getCompactionRequestAuth(
		model: Model<any>,
	): Promise<{ apiKey?: string; headers?: Record<string, string> }> {
		if (this.agent.streamFn === streamSimple) {
			const result = await this._modelRegistry.getApiKeyAndHeaders(model);
			if (!result.ok) throw new Error(result.error);
			return { apiKey: result.apiKey, headers: result.headers };
		}
		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		return result.ok ? { apiKey: result.apiKey, headers: result.headers } : {};
	}

	// =========================================================================
	// Private: Retry
	// =========================================================================

	private _willRetryAfterAgentEnd(_event: any): boolean {
		return false;
	}

	// =========================================================================
	// Private: Agent loop
	// =========================================================================

	private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
		try {
			await this.agent.prompt(messages);
			while (await this._handlePostAgentRun()) {
				await this.agent.continue();
			}
		} finally {
		}
	}

	private async _handlePostAgentRun(): Promise<boolean> {
		this._lastAssistantMessage = undefined;
		return false;
	}

	// =========================================================================
	// Private: Extension commands & skills
	// =========================================================================

	private async _tryExtensionCommand(text: string): Promise<boolean> {
		const spaceIdx = text.indexOf(" ");
		const cmdName = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
		const cmd = this._extensionRunner.getCommand(cmdName);
		if (!cmd) return false;
		const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
		await cmd.handler(args, this._extensionRunner.createCommandContext());
		return true;
	}

	private _expandSkillCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;
		return text;
	}

	// =========================================================================
	// Private: Extension system & tools
	// =========================================================================

	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	private _buildRuntime(_options: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
		const runner = new (ExtensionRunner as any)(
			this._modelRegistry,
			this.agent,
			this,
			this.settingsManager,
			this._sessionStartEvent,
		);
		this._extensionRunner = runner;
		if (this._extensionRunnerRef) this._extensionRunnerRef.current = runner;

		// Register tools from executor
		for (const tool of this._toolExecutor.getTools()) {
			const si = createSyntheticSourceInfo("builtin", { source: "builtin" });
			this._toolRegistry.set(tool.name, tool);
			this._toolDefinitions.set(tool.name, { definition: tool as any, sourceInfo: si });
		}
		// Register custom tools
		for (const td of this._customTools) {
			const si = createSyntheticSourceInfo("builtin", { source: "builtin" });
			this._toolRegistry.set(td.name as any, td as any);
			this._toolDefinitions.set(td.name, { definition: td, sourceInfo: si });
		}

		const allNames = Array.from(this._toolRegistry.keys()).filter((n) => {
			if (this._allowedToolNames && !this._allowedToolNames.has(n)) return false;
			if (this._excludedToolNames?.has(n)) return false;
			return true;
		});
		this.agent.state.tools = allNames.map((n) => this._toolRegistry.get(n)!).filter(Boolean);
		this._baseSystemPrompt = this._rebuildSystemPrompt(allNames);
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	private _rebuildSystemPrompt(toolNames: string[]): string {
		const snippets: Record<string, string> = {};
		const guidelines: string[] = [];
		for (const n of toolNames) {
			const s = this._toolPromptSnippets.get(n);
			if (s) snippets[n] = s;
			const g = this._toolPromptGuidelines.get(n);
			if (g) guidelines.push(...g);
		}
		this._baseSystemPromptOptions = {
			cwd: this._cwd,
			skills: [],
			contextFiles: [],
			selectedTools: toolNames,
			toolSnippets: snippets,
			promptGuidelines: guidelines,
		};
		return buildSystemPrompt(this._baseSystemPromptOptions);
	}

	clearQueue(): { steering: string[]; followUp: string[] } {
		const r = { steering: [...this._steeringMessages], followUp: [...this._followUpMessages] };
		this._steeringMessages = [];
		this._followUpMessages = [];
		this.agent.clearAllQueues();
		this._emitQueueUpdate();
		return r;
	}

	getSteeringMessages(): readonly string[] {
		return this._steeringMessages;
	}
	getFollowUpMessages(): readonly string[] {
		return this._followUpMessages;
	}

	async reloadExtensions(): Promise<void> {
		const old = this._extensionRunner;
		await this.agent.waitForIdle();
		const runner = new (ExtensionRunner as any)(
			this._modelRegistry,
			this.agent,
			this,
			this.settingsManager,
			this._sessionStartEvent,
		);
		this._extensionRunner = runner;
		if (this._extensionRunnerRef) this._extensionRunnerRef.current = runner;
		old.invalidate("Extensions reloaded.");
	}
}
