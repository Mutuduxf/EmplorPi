/**
 * Package manager - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface PathMetadata {
	path: string;
	type: "file" | "directory";
	source?: string;
	scope?: string;
	origin?: string;
	baseDir?: string;
}

export interface ResolvedResource {
	path: string;
	type: "file" | "directory";
	source: string;
	enabled?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ResolvedPaths {
	paths: ResolvedResource[];
	extensions: ResolvedResource[];
	skills: ResolvedResource[];
	prompts: ResolvedResource[];
	themes: ResolvedResource[];
}

export interface PackageManager {
	resolvePaths(pattern: string): Promise<ResolvedPaths>;
}
