/**
 * JSON utility - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export function parseJsonSafe<T = unknown>(text: string): T | undefined {
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

export function formatJson(value: unknown, space = 2): string {
	return JSON.stringify(value, null, space);
}

export function stripJsonComments(text: string): string {
	// Minimal implementation: remove // and /* */ comments
	return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function parseJsonWithComments<T = unknown>(text: string): T | undefined {
	try {
		return JSON.parse(stripJsonComments(text)) as T;
	} catch {
		return undefined;
	}
}
