/**
 * Bash execution component - stub for coding-specific rendering.
 * Full implementation in @earendil-works/pi-coding-agent.
 */

import type { Component } from "@earendil-works/pi-tui";

export interface BashExecutionComponentOptions {
	command: string;
	output?: string;
	exitCode?: number;
}

export class BashExecutionComponent implements Component {
	constructor(_options: BashExecutionComponentOptions) {}
	render(_width: number): string[] { return []; }
	invalidate(): void {}
}
