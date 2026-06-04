/** Stub for pi-base */
export interface ToolHtmlRendererOptions {
	getToolDefinition: (name: string) => any;
	theme: any;
	cwd: string;
}
export function createToolHtmlRenderer(_opts: ToolHtmlRendererOptions): { renderTool: () => string } {
	return { renderTool: () => "" };
}
