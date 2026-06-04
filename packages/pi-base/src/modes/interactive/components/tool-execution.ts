/**
 * Tool execution component - stub for coding-specific rendering.
 * Full implementation in @earendil-works/pi-coding-agent.
 */

import type { Component } from "@earendil-works/pi-tui";

export interface ToolExecutionOptions {
	toolName: string;
	toolCallId: string;
}

export class ToolExecutionComponent implements Component {
	constructor(_toolName: string, _toolCallId: string, _args: Record<string, unknown>) {}
	render(_width: number): string[] { return []; }
	invalidate(): void {}
}
