/**
 * @earendil-works/pi-base
 *
 * Generic foundation layer for LLM-powered agents.
 * Provides session management, model registry, auth, events, and extension system.
 *
 * This package extracts non-coding-specific functionality from @earendil-works/pi-coding-agent
 * so that it can be reused by agents that don't need file/bash/edit tools.
 */

// CLI args
export { type Args, parseArgs, printHelp } from "./cli/args.ts";
// Config paths
export { getAgentDir, VERSION } from "./config.ts";
// Auth guidance
export { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./core/auth-guidance.ts";
// Auth storage
export {
	type ApiKeyCredential,
	type AuthCredential,
	type AuthStatus,
	AuthStorage,
	type AuthStorageBackend,
	FileAuthStorageBackend,
	InMemoryAuthStorageBackend,
	type OAuthCredential,
} from "./core/auth-storage.ts";
// Compaction
export {
	type BranchPreparation,
	type BranchSummaryResult,
	type CollectEntriesResult,
	type CompactionResult,
	type CutPointResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	type FileOperations,
	findCutPoint,
	findTurnStartIndex,
	type GenerateBranchSummaryOptions,
	generateBranchSummary,
	generateSummary,
	getLastAssistantUsage,
	prepareBranchEntries,
	serializeConversation,
	shouldCompact,
} from "./core/compaction/index.ts";
// Defaults
export { DEFAULT_THINKING_LEVEL } from "./core/defaults.ts";
// Diagnostics
export type { ResourceCollision, ResourceDiagnostic } from "./core/diagnostics.ts";
// Event bus
export { createEventBus, type EventBus, type EventBusController } from "./core/event-bus.ts";
// Extension system types
export type {
	AgentEndEvent,
	AgentStartEvent,
	AgentToolResult,
	AgentToolUpdateCallback,
	AppKeybinding,
	AutocompleteProviderFactory,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeProviderRequestEvent,
	BeforeProviderRequestEventResult,
	BuildSystemPromptOptions as ExtensionBuildSystemPromptOptions,
	CompactOptions,
	ContextEvent,
	ContextUsage,
	CustomToolCallEvent,
	ExecOptions,
	ExecResult,
	Extension,
	ExtensionActions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionHandler,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	InputEvent,
	InputEventResult,
	InputSource,
	KeybindingsManager,
	LoadExtensionsResult,
	MessageRenderer,
	MessageRenderOptions,
	ProviderConfig,
	ProviderModelConfig,
	RegisteredCommand,
	RegisteredTool,
	ResolvedCommand,
	SessionBeforeCompactEvent,
	SessionBeforeForkEvent,
	SessionBeforeSwitchEvent,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
	SlashCommandInfo as ExtensionSlashCommandInfo,
	SlashCommandSource,
	SourceInfo as ExtensionSourceInfo,
	TerminalInputHandler,
	ToolCallEvent,
	ToolCallEventResult,
	ToolDefinition,
	ToolExecutionMode,
	ToolInfo,
	ToolRenderResultOptions,
	ToolResultEvent,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	WidgetPlacement,
	WorkingIndicatorOptions,
} from "./core/extensions/index.ts";
// Extension system runtime
export {
	createExtensionRuntime,
	defineTool,
	discoverAndLoadExtensions,
	ExtensionRunner,
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isReadToolResult,
	isToolCallEventType,
	isWriteToolResult,
	wrapRegisteredTool,
	wrapRegisteredTools,
} from "./core/extensions/index.ts";
// Messages
export {
	type BashExecutionMessage,
	BRANCH_SUMMARY_PREFIX,
	BRANCH_SUMMARY_SUFFIX,
	type BranchSummaryMessage,
	bashExecutionToText,
	COMPACTION_SUMMARY_PREFIX,
	COMPACTION_SUMMARY_SUFFIX,
	type CompactionSummaryMessage,
	type CustomMessage,
	convertToLlm,
	createBranchSummaryMessage,
	createCompactionSummaryMessage,
	createCustomMessage,
} from "./core/messages.ts";
// Model registry
export { ModelRegistry } from "./core/model-registry.ts";
export {
	type ParsedModelResult,
	type ResolveCliModelResult,
	resolveCliModel,
	resolveModelScope,
	type ScopedModel,
} from "./core/model-resolver.ts";
// Output guard
export { restoreStdout, takeOverStdout } from "./core/output-guard.ts";
// Prompt templates
export {
	expandPromptTemplate,
	type PromptTemplate,
} from "./core/prompt-templates.ts";
// Provider display info
export { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "./core/provider-display-names.ts";
// Resolve config values
export { resolveConfigValue } from "./core/resolve-config-value.ts";
// Session (generic, no coding-specific tooling)
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ExtensionBindings,
	type ModelCycleResult,
	type ParsedSkillBlock,
	type PromptOptions,
	parseSkillBlock,
	type SessionStats,
} from "./core/session.ts";
// Session CWD
export { MissingSessionCwdError, type SessionCwdIssue } from "./core/session-cwd.ts";
// Session manager
export {
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	type NewSessionOptions,
	parseSessionEntries,
	type SessionContext,
	type SessionEntry,
	type SessionEntryBase,
	type SessionHeader,
	type SessionInfo,
	type SessionInfoEntry,
	SessionManager,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager.ts";
// Settings manager
export {
	type CompactionSettings,
	type ImageSettings,
	type PackageSource,
	type RetrySettings,
	SettingsManager,
} from "./core/settings-manager.ts";
// Skills
export {
	formatSkillsForPrompt,
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
} from "./core/skills.ts";
// Slash commands
export {
	BUILTIN_SLASH_COMMANDS,
	type BuiltinSlashCommand,
	type SlashCommandInfo,
} from "./core/slash-commands.ts";
// Source info
export { createSyntheticSourceInfo, type SourceInfo } from "./core/source-info.ts";
// System prompt
export {
	type BuildSystemPromptOptions,
	buildSystemPrompt,
} from "./core/system-prompt.ts";
// Timings
export { printTimings, resetTimings, time } from "./core/timings.ts";
// Tool executor interface (to be implemented by consumers)
export type { ToolExecuteResult, ToolExecutor } from "./core/tools/types.ts";
// Migrations
export { runMigrations, showDeprecationWarnings } from "./migrations.ts";
export { spawnProcess, spawnProcessSync, waitForChildProcess } from "./utils/child-process.ts";
export { clearDeprecationWarningsForTests, warnDeprecation } from "./utils/deprecation.ts";
export { parseFrontmatter, stripFrontmatter } from "./utils/frontmatter.ts";
// Utility functions
export { canonicalizePath, normalizePath, type PathInputOptions, resolvePath } from "./utils/paths.ts";
export { getShellConfig, type ShellConfig } from "./utils/shell.ts";
export { sleep } from "./utils/sleep.ts";
