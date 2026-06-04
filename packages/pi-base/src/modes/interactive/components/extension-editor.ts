/**
 * Extension editor component - stub for pi-base.
 * Full implementation in @earendil-works/pi-coding-agent.
 */

import type { Component } from "@earendil-works/pi-tui";

export class ExtensionEditorComponent implements Component {
	constructor(_title: string, _content: string, _onSave?: (text: string) => void) {}
	render(_width: number): string[] { return []; }
	invalidate(): void {}
}
