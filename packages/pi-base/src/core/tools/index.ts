/**
 * Minimal stub for compatibility with extension types.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface BashToolInput {
	command: string;
}

export interface ReadToolInput {
	path: string;
}

export interface EditToolInput {
	path: string;
	oldText: string;
	newText: string;
}

export interface WriteToolInput {
	path: string;
	content: string;
}

export interface GrepToolInput {
	pattern: string;
	path?: string;
}

export interface FindToolInput {
	pattern: string;
	path?: string;
}

export interface LsToolInput {
	path: string;
}

export interface BashToolDetails {
	command: string;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ReadToolDetails {
	path: string;
	content: string;
}

export interface EditToolDetails {
	path: string;
	oldText: string;
	newText: string;
}

export interface WriteToolDetails {
	path: string;
}

export interface GrepToolDetails {
	pattern: string;
	matches: number;
}

export interface FindToolDetails {
	pattern: string;
	results: string[];
}

export interface LsToolDetails {
	path: string;
	entries: string[];
}
