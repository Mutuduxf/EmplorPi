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

export interface ResolvedPaths {
	paths: PathMetadata[];
}

export interface PackageManager {
	resolvePaths(pattern: string): Promise<ResolvedPaths>;
}
