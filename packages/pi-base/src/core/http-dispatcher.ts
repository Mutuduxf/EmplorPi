/**
 * HTTP dispatcher - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export const httpDispatcher = {
	setProxy: (_url?: string) => {},
	getProxy: () => undefined as string | undefined,
};

/** Default timeout for HTTP idle connections. */
export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 30_000;

/** Parse HTTP idle timeout from environment variable, returning default if unset or invalid. */
export const HTTP_IDLE_TIMEOUT_CHOICES: number[] = [];
export function formatHttpIdleTimeoutMs(_ms: number): string { return ""; }
export function parseHttpIdleTimeoutMs(_envValue?: string): number {
	return DEFAULT_HTTP_IDLE_TIMEOUT_MS;
}
