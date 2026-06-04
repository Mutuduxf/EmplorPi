/**
 * Tool definition wrapper for pi-base.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

export function wrapToolDefinition<TParams extends TSchema>(tool: AgentTool<TParams>): AgentTool<TParams> {
	return tool;
}

export function wrapToolDefinitions<TParams extends TSchema>(tools: AgentTool<TParams>[]): AgentTool<TParams>[] {
	return tools;
}

export function createToolDefinitionFromAgentTool<TParams extends TSchema>(
	tool: AgentTool<TParams>,
): AgentTool<TSchema> {
	return tool as unknown as AgentTool<TSchema>;
}
