/**
 * ToolExecutor - Interface for tool execution.
 *
 * Implement this interface to provide tool execution capabilities to the agent session.
 * The coding-agent package implements this with read/write/bash/edit tools.
 * Third-party agents can implement it with their own domain-specific tools.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

export interface ToolExecuteResult {
	content: AgentToolResult<any>["content"];
	details?: AgentToolResult<any>["details"];
	isError: boolean;
}

/**
 * Abstract executor for LLM-callable tools.
 *
 * `getTools()` returns the available tool definitions for the LLM.
 * `execute(name, args)` runs the tool and returns its result.
 */
export interface ToolExecutor {
	getTools(): AgentTool[];
	execute(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecuteResult>;
}
