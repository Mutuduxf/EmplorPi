/**
 * Tool definition wrapper for pi-base.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

export function wrapToolDefinition(
	tool: any,
	..._args: any[]
): any {
	return tool;
}

export function wrapToolDefinitions(
	tools: any[],
	..._args: any[]
): any[] {
	return tools;
}

export function createToolDefinitionFromAgentTool<TParams extends TSchema>(
	tool: AgentTool<TParams>,
): AgentTool<TSchema> {
	return tool as unknown as AgentTool<TSchema>;
}
