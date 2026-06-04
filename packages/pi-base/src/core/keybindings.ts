/**
 * Keybindings for pi-base.
 */

import type { KeyId } from "@earendil-works/pi-tui";

export type { KeyId };

export interface KeybindingsConfig {
	[key: string]: KeyId[];
}

export interface AppKeybinding {
	keys: KeyId[];
	command: string;
}

export interface KeybindingsManager {
	config: KeybindingsConfig;
	appKeybindings: AppKeybinding[];
}

export function migrateKeybindingsConfig(_config: Record<string, unknown>): {
	config: Record<string, unknown>;
	migrated: boolean;
} {
	return { config: _config as Record<string, unknown>, migrated: false };
}

export { matchesKey } from "@earendil-works/pi-tui";
