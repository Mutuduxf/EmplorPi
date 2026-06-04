/**
 * Minimal stub for compatibility with extension types.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface ReadonlyFooterDataProvider {
	getBranchName(): string | undefined;
	getExtensionStatuses(): string[];
}
