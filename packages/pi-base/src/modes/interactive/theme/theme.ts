/**
 * Theme types and utilities - minimal implementation for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

import type { Component, MarkdownTheme as TuiMarkdownTheme } from "@earendil-works/pi-tui";

export interface Theme {
	name: string;
	fg: (color: string, str: string) => string;
	bg: (color: string, str: string) => string;
	bold: (str: string) => string;
	italic: (str: string) => string;
	[key: string]: unknown;
}

export type ThemeColor = string;

export { type Component };

export function getLanguageFromPath(_path: string): string | undefined {
	const ext = _path.split(".").pop()?.toLowerCase();
	const langMap: Record<string, string> = {
		ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
		rs: "rust", py: "python", go: "go", java: "java",
		cpp: "cpp", c: "c", h: "c", hpp: "cpp",
		md: "markdown", json: "json", yaml: "yaml", yml: "yaml",
		toml: "toml", sh: "bash", bash: "bash", zsh: "bash",
		html: "html", css: "css", sql: "sql", rb: "ruby",
	};
	return ext ? langMap[ext] : undefined;
}

export function highlightCode(_code: string, _language: string): string {
	return _code;
}

export const theme: Theme = {
	name: "default",
	fg: (_color: string, str: string) => str,
	bg: (_color: string, str: string) => str,
	bold: (str: string) => str,
	italic: (str: string) => str,
};

export type MarkdownTheme = TuiMarkdownTheme;

export function getMarkdownTheme(): MarkdownTheme {
	return {} as MarkdownTheme;
}

export function getSelectListTheme(): any {
	return {};
}

export function getSettingsListTheme(): any {
	return {};
}

export function initTheme(_themeName?: string, _enableWatcher?: boolean): void {}

export function getAvailableThemes(): string[] { return []; }
export function stopThemeWatcher(): void {}
