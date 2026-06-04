/**
 * Process execution utilities for pi-base.
 */

import { spawn } from "node:child_process";

export interface ExecOptions {
	timeoutMs?: number;
	cwd?: string;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

export function execCommand(
	command: string,
	args: string[],
	_cwd?: string | ExecOptions,
	options?: ExecOptions,
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timeout: NodeJS.Timeout | undefined;

		if (options?.timeoutMs) {
			timeout = setTimeout(() => {
				child.kill();
				reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
			}, options.timeoutMs);
		}

		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});
		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});
		child.on("close", (code) => {
			if (timeout) clearTimeout(timeout);
			resolve({ stdout, stderr, exitCode: code });
		});
		child.on("error", (err) => {
			if (timeout) clearTimeout(timeout);
			reject(err);
		});
	});
}
