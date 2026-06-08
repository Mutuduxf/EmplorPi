import type { FileEntry, SessionManager } from "../session-manager.ts";
export type AgentState = { messages: any[]; model: any; systemPrompt: string; tools: any[]; thinkingLevel: string };
export interface ToolHtmlRenderer {
	renderTool(): string;
}
export function exportSessionToHtml(_sm: SessionManager, _state: AgentState, _opts: any): string {
	return "";
}
export function exportFromFile(_path: string, _outputPath?: string): Promise<string> {
	return Promise.resolve("");
}
