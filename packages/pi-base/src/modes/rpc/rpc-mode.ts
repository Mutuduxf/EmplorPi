/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Generic version for pi-base. Receives commands as JSON on stdin,
 * outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 */

import * as crypto from "node:crypto";
import type { AgentSession } from "../../core/session.ts";
import type { ExtensionUIContext, ExtensionUIDialogOptions, WorkingIndicatorOptions } from "../../core/extensions/index.ts";
import { flushRawStdout, takeOverStdout, waitForRawStdoutBackpressure, writeRawStdout } from "../../core/output-guard.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type { RpcCommand, RpcExtensionUIRequest, RpcExtensionUIResponse, RpcResponse, RpcSessionState, RpcSlashCommand } from "./rpc-types.ts";

// Re-export types for consumers
export type { RpcCommand, RpcExtensionUIRequest, RpcExtensionUIResponse, RpcResponse, RpcSessionState } from "./rpc-types.ts";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
	takeOverStdout();
	let unsubscribe: (() => void) | undefined;

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	const success = <T extends RpcCommand["type"]>(id: string | undefined, command: T, data?: object | null): RpcResponse => {
		if (data === undefined) return { id, type: "response", command, success: true } as RpcResponse;
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	const pendingExtensionRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

	function createDialogPromise<T>(opts: ExtensionUIDialogOptions | undefined, defaultValue: T, request: Record<string, unknown>, parseResponse: (response: RpcExtensionUIResponse) => T): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};
			const onAbort = () => { cleanup(); resolve(defaultValue); };
			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts?.timeout) {
				timeoutId = setTimeout(() => { cleanup(); resolve(defaultValue); }, opts.timeout);
			}
			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => { cleanup(); resolve(parseResponse(response)); },
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	const extensionUIContext: ExtensionUIContext = {
		select: (title, options, opts) => createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) => "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
		confirm: (title, message, opts) => createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) => "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
		input: (title, placeholder, opts) => createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) => "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
		notify(message: string, type?: "info" | "warning" | "error") { output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message, notifyType: type } as RpcExtensionUIRequest); },
		onTerminalInput() { return () => {}; },
		setStatus(key: string, text: string | undefined) { output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setStatus", statusKey: key, statusText: text } as RpcExtensionUIRequest); },
		setWorkingMessage(_message?: string) {},
		setWorkingVisible(_visible: boolean) {},
		setWorkingIndicator(_options?: WorkingIndicatorOptions) {},
		setHiddenThinkingLabel(_label?: string) {},
		setWidget(key: string, content: unknown, options?: any) {
			if (content === undefined || Array.isArray(content)) {
				output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setWidget", widgetKey: key, widgetLines: content as string[] | undefined, widgetPlacement: options?.placement } as RpcExtensionUIRequest);
			}
		},
		setFooter(_factory: unknown) {},
		setHeader(_factory: unknown) {},
		setTitle(title: string) { output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setTitle", title } as RpcExtensionUIRequest); },
		async custom() { return undefined as never; },
		pasteToEditor(text: string) { this.setEditorText(text); },
		setEditorText(text: string) { output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "set_editor_text", text } as RpcExtensionUIRequest); },
		getEditorText() { return ""; },
		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => { resolve("cancelled" in response && response.cancelled ? undefined : "value" in response ? response.value : undefined); },
					reject,
				});
				output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
			});
		},
		addAutocompleteProvider() {},
		setEditorComponent() {},
		getEditorComponent() { return undefined; },
		get theme() { return { name: "default", fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s, bold: (s: string) => s }; },
		getAllThemes() { return []; },
		getTheme(_name: string) { return undefined; },
		setTheme(_theme: any) { return { success: false, error: "Theme switching not supported in RPC mode" }; },
		getToolsExpanded() { return false; },
		setToolsExpanded(_expanded: boolean) {},
	};

	// Subscribe to session events
	unsubscribe = session.subscribe((event) => {
		output(event);
	});

	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		switch (command.type) {
			case "prompt": {
				let preflightSucceeded = false;
				void session.prompt(command.message, {
					images: command.images,
					streamingBehavior: command.streamingBehavior,
					source: "rpc",
					preflightResult: (didSucceed) => {
						if (didSucceed) { preflightSucceeded = true; output(success(id, "prompt")); }
					},
				}).catch((e) => {
					if (!preflightSucceeded) output(error(id, "prompt", e.message));
				});
				return undefined;
			}
			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}
			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}
			case "abort": {
				await session.abort();
				return success(id, "abort");
			}
			case "new_session": {
				session.newSession();
				return success(id, "new_session", { cancelled: false });
			}

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
				};
				return success(id, "get_state", state);
			}
			case "set_model": {
				const models = await session.modelRegistry.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				await session.setModel(model);
				return success(id, "set_model", model);
			}
			case "cycle_model": {
				const result = await session.cycleModel();
				return success(id, "cycle_model", result ?? null);
			}
			case "get_available_models": {
				const models = await session.modelRegistry.getAvailable();
				return success(id, "get_available_models", { models });
			}
			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}
			case "compact": {
				await session.compact();
				return success(id, "compact", undefined);
			}
			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}
			case "set_session_name": {
				session.setSessionName(command.name);
				return success(id, "set_session_name");
			}

			default: {
				const unknown = command as { type: string };
				return error(undefined, unknown.type, `Unknown command: ${unknown.type}`);
			}
		}
	};

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(error(undefined, "parse", `Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
			await waitForRawStdoutBackpressure();
			return;
		}

		if (typeof parsed === "object" && parsed !== null && "type" in parsed && (parsed as any).type === "extension_ui_response") {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) { pendingExtensionRequests.delete(response.id); pending.resolve(response); }
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await handleCommand(command);
			if (response) { output(response); await waitForRawStdoutBackpressure(); }
		} catch (commandError: unknown) {
			output(error(command.id, command.type, commandError instanceof Error ? commandError.message : String(commandError)));
			await waitForRawStdoutBackpressure();
		}
	};

	process.stdin.on("end", () => { void (async () => { await flushRawStdout(); process.exit(0); })(); });
	const detach = attachJsonlLineReader(process.stdin, (line) => { void handleInputLine(line); });

	return new Promise(() => {});
}
