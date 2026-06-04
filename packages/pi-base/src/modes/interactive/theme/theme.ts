/**
 * Theme types - minimal stub for compatibility with extension types.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

import type { Component } from "@earendil-works/pi-tui";

export interface Theme {
	name: string;
	[key: string]: unknown;
}

export interface ThemeColor {
	fg: string;
	bg?: string;
}

export type { Component };
