/**
 * Minimal stub for compatibility with extension types.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface BashOperations {
	execute(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface BashToolDetails {
	command: string;
	stdout: string;
	stderr: string;
	exitCode: number;
}
