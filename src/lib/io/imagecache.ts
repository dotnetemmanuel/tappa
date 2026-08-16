import type { AssetId } from '../core/doc/types.js';
import { getAsset } from './store.js';

const images = new Map<AssetId, CanvasImageSource>();
const inFlight = new Map<AssetId, Promise<void>>();
const failed = new Set<AssetId>();
const listeners = new Set<() => void>();

/** Synchronous lookup for the renderers; returns null until the bitmap has loaded. */
export function getImageSync(assetId: AssetId): CanvasImageSource | null {
	return images.get(assetId) ?? null;
}

/** Start loading everything the document references. Safe to call repeatedly. */
export async function preloadAssets(
	assetIds: readonly AssetId[],
	resolve: (id: AssetId) => string | null
): Promise<void> {
	const pending: Promise<void>[] = [];
	for (const id of new Set(assetIds)) {
		if (images.has(id) || failed.has(id)) continue;
		const running = inFlight.get(id);
		if (running) {
			pending.push(running);
			continue;
		}
		const hash = resolve(id);
		if (!hash) {
			failed.add(id);
			continue;
		}
		const load = loadOne(id, hash).finally(() => inFlight.delete(id));
		inFlight.set(id, load);
		pending.push(load);
	}
	await Promise.all(pending);
}

/** Put a freshly ingested bitmap straight into the cache, so it draws without a round trip. */
export function putImage(assetId: AssetId, bitmap: ImageBitmap): void {
	failed.delete(assetId);
	images.set(assetId, bitmap);
	notify();
}

/** Called when the renderer should repaint because an image finished loading. */
export function onImageLoaded(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function clearImageCache(): void {
	if (typeof ImageBitmap !== 'undefined') {
		for (const src of images.values()) if (src instanceof ImageBitmap) src.close();
	}
	images.clear();
	inFlight.clear();
	failed.clear();
	notify();
}

async function loadOne(id: AssetId, hash: string): Promise<void> {
	const blob = await getAsset(hash);
	if (!blob) {
		failed.add(id);
		return;
	}
	const bitmap = await decodeBlob(blob);
	if (!bitmap) {
		failed.add(id);
		return;
	}
	images.set(id, bitmap);
	notify();
}

/** Same orientation handling as ingest, so a reloaded image matches the size stored on its asset. */
async function decodeBlob(blob: Blob): Promise<ImageBitmap | null> {
	if (typeof createImageBitmap === 'undefined') return null;
	try {
		return await createImageBitmap(blob, { imageOrientation: 'from-image' });
	} catch {
		return null;
	}
}

function notify(): void {
	for (const fn of Array.from(listeners)) fn();
}
