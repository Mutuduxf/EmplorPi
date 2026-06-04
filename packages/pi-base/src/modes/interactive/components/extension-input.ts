/**
 * Extension input component - stub for pi-base.
 * Full implementation in @earendil-works/pi-coding-agent.
 */

import type { Component } from "@earendil-works/pi-tui";

export class ExtensionInputComponent implements Component {
	constructor(_title: string, _onSubmit?: (text: string) => void) {}
	render(_width: number): string[] { return []; }
	invalidate(): void {}
}
