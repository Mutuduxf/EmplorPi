/**
 * Extension Runner - minimal implementation for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ReplacedSessionContext } from "./types.ts";

export type ExtensionErrorListener = (error: { extensionPath: string; event: string; error: string }) => void;
export type ForkHandler = (
	entryId: string,
	options?: { position?: "at" | "before"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;
export type NavigateTreeHandler = (
	sessionPath: string,
	options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;
export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: any) => Promise<void>;
	withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;
export type ShutdownHandler = () => void;
export type SwitchSessionHandler = (
	sessionPath: string,
	options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;

export type { ReplacedSessionContext };

export class ExtensionRunner {
	private _invalidated = false;

	get invalidated(): boolean {
		return this._invalidated;
	}

	invalidate(_message: string): void {
		this._invalidated = true;
	}

	hasHandlers(_eventType: string): boolean {
		return false;
	}

	async emit(_event: any): Promise<void> {}

	async emitToolCall(_event: any): Promise<any> {
		return undefined;
	}
	async emitToolResult(_event: any): Promise<any> {
		return undefined;
	}
	async emitInput(
		_text: string,
		_images?: ImageContent[],
		_source?: string,
		_streamingBehavior?: string,
	): Promise<{ action: "continue" | "handled" | "transform"; text?: string; images?: ImageContent[] }> {
		return { action: "continue" };
	}
	async emitMessageEnd(_event: any): Promise<AgentMessage | undefined> {
		return undefined;
	}
	async emitBeforeAgentStart(
		_text: string,
		_images?: ImageContent[],
		_baseSystemPrompt?: string,
		_baseSystemPromptOptions?: any,
	): Promise<any> {
		return undefined;
	}
	async emitResourcesDiscover(
		_extensionDirs: string[],
	): Promise<{ skillPaths: string[]; promptPaths: string[]; themePaths: string[] }> {
		return { skillPaths: [], promptPaths: [], themePaths: [] };
	}
	async emitReplacedSession(_replacedSession: ReplacedSessionContext): Promise<void> {}

	emitError(_error: { extensionPath: string; event: string; error: string }): void {}

	onError(_listener: ExtensionErrorListener): () => void {
		return () => {};
	}

	getCommand(_name: string): { handler: (args: string, ctx: any) => Promise<void>; description: string } | undefined {
		return undefined;
	}

	createCommandContext(): any {
		return {
			sendMessage: async () => {},
			sendCustomMessage: async () => {},
			abort: () => {},
			shutdown: async () => {},
			reload: async () => {},
			fork: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			newSession: async () => ({ cancelled: false }),
			getSessionId: () => "",
		};
	}
}

export async function emitSessionShutdownEvent(..._args: any[]): Promise<void> {}
