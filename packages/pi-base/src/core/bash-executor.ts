/**
 * Minimal stub for compatibility with extension types.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface BashResult {
	command: string;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: string | null;
	output: string;
	truncated: boolean;
	error?: string;
	fullOutputPath?: string;
	timedOut: boolean;
}
