/**
 * Image resize - minimal stub for pi-base.
 * Full implementation lives in @earendil-works/pi-coding-agent.
 */

export function formatDimensionNote(_originalSize: number, _resizedSize: number): string {
	return "";
}

export async function resizeImage(_data: Buffer, _maxBytes: number): Promise<{ data: Buffer; mimeType: string }> {
	return { data: _data, mimeType: "image/png" };
}
