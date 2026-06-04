/**
 * Tool binary management - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 * Falls back to assuming fd/rg are on PATH.
 */

export async function ensureTool(_name: string, _autoInstall?: boolean): Promise<string> {
	return _name;
}
