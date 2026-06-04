import type { KeyId } from "@earendil-works/pi-tui";
export type { KeyId };
export interface KeybindingsConfig { [key: string]: KeyId[]; }
export interface AppKeybinding { keys: KeyId[]; command: string; }
export interface KeybindingsManager { config: KeybindingsConfig; appKeybindings: AppKeybinding[]; matches(key: string, binding: any): boolean; }
export function migrateKeybindingsConfig(_config: Record<string, unknown>): { config: Record<string, unknown>; migrated: boolean } {
  return { config: _config as Record<string, unknown>, migrated: false };
}
export function matchesKey(_keyData: string, _keyId: any): boolean { return false; }
export function getKeybindings(): any { return { config: {}, appKeybindings: [], matches: (_key: string, _binding?: any) => false }; }
