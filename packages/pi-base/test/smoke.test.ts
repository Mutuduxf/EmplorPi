/**
 * Smoke test for @earendil-works/pi-base.
 * Verifies that core modules can be imported and instantiated correctly.
 */

import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { registerFauxProvider } from "@earendil-works/pi-ai";
import { existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "../src/core/auth-guidance.ts";
import { AuthStorage, InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import { DEFAULT_THINKING_LEVEL } from "../src/core/defaults.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { expandPromptTemplate } from "../src/core/prompt-templates.ts";
import { AgentSession, type AgentSessionConfig, parseSkillBlock } from "../src/core/session.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import type { ToolExecuteResult, ToolExecutor } from "../src/core/tools/types.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-base-test-"));
});

afterEach(() => {
	try {
		tmpDir && existsSync(tmpDir);
	} catch {
		/* ignore */
	}
});

describe("pi-base core imports", () => {
	it("should import event-bus", () => {
		const bus = createEventBus();
		expect(bus).toBeDefined();
		expect(bus.emit).toBeTypeOf("function");
	});

	it("should import auth-storage", () => {
		const backend = new InMemoryAuthStorageBackend();
		const storage = new AuthStorage(backend);
		expect(storage).toBeDefined();
	});

	it("should create settings-manager with temp dir", () => {
		const sm = SettingsManager.create(tmpDir, tmpDir);
		expect(sm).toBeDefined();
		const ts = sm.getCompactionSettings();
		expect(ts).toBeDefined();
	});

	it("should create session-manager", () => {
		const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"), true);
		expect(sm).toBeDefined();
		expect(sm.getSessionId()).toBeTypeOf("string");
	});

	it("should import model-registry", () => {
		const backend = new InMemoryAuthStorageBackend();
		const authStorage = new AuthStorage(backend);
		const mr = ModelRegistry.inMemory(authStorage);
		expect(mr).toBeDefined();
	});

	it("should import utility functions", () => {
		expect(DEFAULT_THINKING_LEVEL).toBeTypeOf("string");
		expect(formatNoApiKeyFoundMessage).toBeTypeOf("function");
		expect(formatNoModelSelectedMessage).toBeTypeOf("function");
	});

	it("should build system prompt", () => {
		const prompt = buildSystemPrompt({
			cwd: tmpDir,
			skills: [],
			contextFiles: [],
			selectedTools: [],
			toolSnippets: {},
			promptGuidelines: [],
		});
		expect(prompt).toBeTypeOf("string");
		expect(prompt.length).toBeGreaterThan(0);
	});

	it("should expand /template commands", () => {
		const templates = [{ name: "hello", content: "Hello {{name}}!" }];
		const result = expandPromptTemplate("/hello Claude", templates);
		expect(result).toBe("Hello {{name}}!");
	});

	it("should pass-through non-template text", () => {
		const result = expandPromptTemplate("hello {{name}}", []);
		expect(result).toBe("hello {{name}}");
	});

	it("should parse skill blocks", () => {
		const result = parseSkillBlock('<skill name="test" location="/tmp/test.md">\ncontent\n</skill>\n\nuser message');
		expect(result).not.toBeNull();
		expect(result!.name).toBe("test");
		expect(result!.content).toBe("content");
		expect(result!.userMessage).toBe("user message");
	});

	it("should convert messages to LLM format", () => {
		const msgs: AgentMessage[] = [
			{ role: "user", content: [{ type: "text" as const, text: "hello" }], timestamp: Date.now() },
		];
		const llmMsgs = convertToLlm(msgs);
		expect(llmMsgs).toHaveLength(1);
		expect(llmMsgs[0]!.role).toBe("user");
	});
});

describe("AgentSession with ToolExecutor", () => {
	it("should create an AgentSession with a minimal tool executor", () => {
		const { streamSimple } = registerFauxProvider({});

		const agent = new Agent({ streamFn: streamSimple });
		const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"), false);
		const settingsManager = SettingsManager.create(tmpDir, tmpDir);
		const authBackend = new InMemoryAuthStorageBackend();
		const authStorage = new AuthStorage(authBackend);
		const modelRegistry = ModelRegistry.inMemory(authStorage);

		const toolExecutor: ToolExecutor = {
			getTools: () => [
				{
					name: "echo",
					description: "Echo back the input",
					parameters: {
						type: "object",
						properties: {
							text: { type: "string" },
						},
						required: ["text"],
					} as any,
				},
			],
			execute: async (_name, _args): Promise<ToolExecuteResult> => {
				return { content: [{ type: "text", text: "executed" }], isError: false };
			},
		};

		const config: AgentSessionConfig = {
			agent,
			sessionManager: sm,
			settingsManager,
			cwd: tmpDir,
			toolExecutor,
			modelRegistry,
		};

		const session = new AgentSession(config);
		expect(session).toBeDefined();
		expect(session.sessionId).toBeTypeOf("string");
		expect(session.getActiveToolNames()).toContain("echo");
	});
});
