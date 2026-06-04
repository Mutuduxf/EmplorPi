/**
 * Keybinding hints - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export function keyHint(_key: string, _description?: string): string {
	return `[${_key}]`;
}

export function keyText(_key: string, _description?: string): string {
	return _key;
}

export function rawKeyHint(_key: string, _description?: string): string {
	return `[${_key}]`;
}

export function formatKeyText(_key: string): string {
	return _key;
}

export function keyDisplayText(_key: string): string {
	return _key;
}
