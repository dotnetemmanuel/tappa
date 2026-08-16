import { nextId } from '../core/doc/ids.js';
import type { AssetRef } from '../core/doc/types.js';
import { putAsset } from './store.js';

export type Ingested = { asset: AssetRef; hash: string; bitmap: ImageBitmap };

/** A drop lands at this many metres across its longer side. */
const DEFAULT_TARGET_METRES = 20;
const THUMB_PX = 256;
const ALPHA_PROBE_PX = 256;

type Surface = {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	ctx: CanvasDrawImage & CanvasImageData;
};

type Box = { x: number; y: number; w: number; h: number };

/**
 * Read a dropped or pasted file, bake in EXIF orientation, store it by content hash.
 * Throws a readable Error when the browser cannot decode the bytes at all.
 */
export async function ingestImage(file: File | Blob, name?: string): Promise<Ingested> {
	const bitmap = await decodeBlob(file);
	if (!bitmap) throw new Error('Bilden gick inte att läsa i den här webbläsaren.');
	const mime = file.type || 'image/png';
	const hash = await putAsset(file, { mime, w: bitmap.width, h: bitmap.height });
	const asset: AssetRef = {
		id: nextId('asset'),
		hash,
		name: name ?? originalName(file),
		mime,
		w: bitmap.width,
		h: bitmap.height,
		bytes: file.size
	};
	return { asset, hash, bitmap };
}

/** Pull image files out of a drop or paste event. Ignores everything else. */
export function imagesFrom(ev: DragEvent | ClipboardEvent): File[] {
	const data = 'dataTransfer' in ev ? ev.dataTransfer : ev.clipboardData;
	if (!data) return [];

	const files = Array.from(data.files ?? []).filter(looksLikeImage);
	if (files.length > 0) return files;

	// A pasted screenshot can arrive as an item with no entry in the file list.
	const out: File[] = [];
	for (const item of Array.from(data.items ?? [])) {
		if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
		const file = item.getAsFile();
		if (file) out.push(file);
	}
	return out;
}

/**
 * Trim fully transparent edges off an alpha PNG, for the cutout billboard flow.
 * Returns the original when there is nothing to trim.
 */
export async function autoCropAlpha(
	bitmap: ImageBitmap
): Promise<{ bitmap: ImageBitmap; cropped: boolean }> {
	const box = opaqueBounds(bitmap);
	if (!box) return { bitmap, cropped: false };
	if (box.x === 0 && box.y === 0 && box.w === bitmap.width && box.h === bitmap.height) {
		return { bitmap, cropped: false };
	}
	if (typeof createImageBitmap === 'undefined') return { bitmap, cropped: false };
	try {
		const trimmed = await createImageBitmap(bitmap, box.x, box.y, box.w, box.h);
		return { bitmap: trimmed, cropped: true };
	} catch {
		return { bitmap, cropped: false };
	}
}

/** A small JPEG or PNG thumbnail for the project browser and the asset list. */
export async function makeThumbnail(bitmap: ImageBitmap, maxPx = THUMB_PX): Promise<Blob> {
	const size = fitWithin(bitmap, maxPx);
	const s = surface(size.w, size.h);
	if (!s) return new Blob([], { type: 'image/png' });
	s.ctx.drawImage(bitmap, 0, 0, size.w, size.h);
	// PNG only where it buys something: transparency survives, everything else stays small.
	const type = anyTransparent(s.ctx, size.w, size.h) ? 'image/png' : 'image/jpeg';
	const blob = await encode(s.canvas, type, 0.82);
	return blob ?? new Blob([], { type });
}

/** True when the image has any partly transparent pixel, so the UI can offer the billboard flow. */
export async function hasAlpha(bitmap: ImageBitmap): Promise<boolean> {
	const size = fitWithin(bitmap, ALPHA_PROBE_PX);
	const s = surface(size.w, size.h);
	if (!s) return false;
	// Downscaling averages alpha, so a transparent region stays below 255 and is still caught.
	s.ctx.drawImage(bitmap, 0, 0, size.w, size.h);
	return anyTransparent(s.ctx, size.w, size.h);
}

/** Metres per pixel that makes an image a sensible size on a fresh plan, so a drop is never absurdly large or small. */
export function defaultScale(bitmap: ImageBitmap, targetMetres = DEFAULT_TARGET_METRES): number {
	const longest = Math.max(bitmap.width, bitmap.height, 1);
	const metres = Number.isFinite(targetMetres) && targetMetres > 0 ? targetMetres : 1;
	return Math.min(1, Math.max(1e-4, metres / longest));
}

/** EXIF orientation is baked in by the browser, so no EXIF parsing and no extra dependency. */
async function decodeBlob(blob: Blob): Promise<ImageBitmap | null> {
	if (typeof createImageBitmap === 'undefined') return null;
	try {
		return await createImageBitmap(blob, { imageOrientation: 'from-image' });
	} catch {
		return null;
	}
}

function originalName(file: File | Blob): string {
	return 'name' in file && typeof file.name === 'string' && file.name ? file.name : 'bild';
}

function looksLikeImage(file: File): boolean {
	if (file.type) return file.type.startsWith('image/');
	return /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(file.name);
}

function fitWithin(bitmap: ImageBitmap, maxPx: number): { w: number; h: number } {
	const longest = Math.max(bitmap.width, bitmap.height, 1);
	const scale = Math.min(1, Math.max(1, maxPx) / longest);
	return {
		w: Math.max(1, Math.round(bitmap.width * scale)),
		h: Math.max(1, Math.round(bitmap.height * scale))
	};
}

/** Smallest box holding every pixel that is not fully transparent, or null when there is none. */
function opaqueBounds(bitmap: ImageBitmap): Box | null {
	const w = bitmap.width;
	const h = bitmap.height;
	const s = surface(w, h);
	if (!s) return null;
	s.ctx.drawImage(bitmap, 0, 0);
	const data = readPixels(s.ctx, w, h);
	if (!data) return null;

	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < h; y++) {
		const row = y * w * 4;
		for (let x = 0; x < w; x++) {
			if (data[row + x * 4 + 3] === 0) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	if (maxX < 0) return null;
	return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function anyTransparent(ctx: CanvasDrawImage & CanvasImageData, w: number, h: number): boolean {
	const data = readPixels(ctx, w, h);
	if (!data) return false;
	for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
	return false;
}

/** Null when the canvas is tainted or the read fails, so callers fall back rather than throw. */
function readPixels(
	ctx: CanvasDrawImage & CanvasImageData,
	w: number,
	h: number
): Uint8ClampedArray | null {
	try {
		return ctx.getImageData(0, 0, w, h).data;
	} catch {
		return null;
	}
}

/** Null outside a browser, which is what keeps this module importable during prerender. */
function surface(w: number, h: number): Surface | null {
	const width = Math.max(1, Math.round(w));
	const height = Math.max(1, Math.round(h));
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d');
		return ctx ? { canvas, ctx } : null;
	}
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	return ctx ? { canvas, ctx } : null;
}

function encode(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	type: string,
	quality: number
): Promise<Blob | null> {
	if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
