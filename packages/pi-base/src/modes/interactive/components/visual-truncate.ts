/**
 * Visual truncation - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export interface VisualTruncateResult {
	visualLines: string[];
	skippedCount: number;
}

export function truncateToVisualLines(text: string, _maxLines: number, _width?: number): VisualTruncateResult {
	const lines = text.split("\n");
	if (lines.length <= _maxLines) {
		return { visualLines: lines, skippedCount: 0 };
	}
	return { visualLines: lines.slice(0, _maxLines), skippedCount: lines.length - _maxLines };
}
