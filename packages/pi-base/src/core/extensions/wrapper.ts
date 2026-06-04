/**
 * Tool wrappers for extension-registered tools - minimal implementation for pi-base.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionRunner } from "./runner.ts";
import type { RegisteredTool } from "./types.ts";

/**
 * Wrap a RegisteredTool into an AgentTool.
 */
export function wrapRegisteredTool(registeredTool: RegisteredTool, _runner: ExtensionRunner): AgentTool {
	return registeredTool.definition as unknown as AgentTool;
}

/**
 * Wrap all registered tools into AgentTools.
 */
export function wrapRegisteredTools(registeredTools: RegisteredTool[], _runner: ExtensionRunner): AgentTool[] {
	return registeredTools.map((t) => t.definition as unknown as AgentTool);
}
