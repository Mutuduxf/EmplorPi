/**
 * Diff rendering - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface RenderDiffOptions {
	oldText: string;
	newText: string;
	path?: string;
	language?: string;
	contextLines?: number;
}

export function renderDiff(options: RenderDiffOptions | string, _theme?: any): string {
	const opts = typeof options === "string" ? { oldText: "", newText: options } : options;
	return `--- a/${opts.path ?? "file"}\n+++ b/${opts.path ?? "file"}\n${opts.oldText !== opts.newText ? "@@ -1 +1 @@\n" : ""}`;
}

export function renderDiffLine(text: string, _type?: string, _maxWidth?: number): string {
	return text;
}
