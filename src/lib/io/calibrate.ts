import type { ImageEntity } from '../core/doc/types.js';
import { add, angle, dist, lerp, mul, rot, rotAround, sub, type Vec2 } from '../core/geom/vec2.js';

/** A calibration in progress. Both points are in plan world metres. */
export type Calibration = { a: Vec2; b: Vec2; realMetres: number };

type Transform = ImageEntity['transform'];
type Size = { w: number; h: number };

/**
 * The new image transform after calibrating, rescaled about the midpoint of the
 * drawn line so it does not jump away.
 */
export function applyCalibration(image: ImageEntity, c: Calibration): Transform {
	const measured = measuredMetres(c);
	if (!(measured > 0) || !(c.realMetres > 0) || !Number.isFinite(c.realMetres)) {
		return image.transform;
	}
	const k = c.realMetres / measured;
	const pivot = lerp(c.a, c.b, 0.5);
	// Scaling both the pixel size and the centre about the pivot scales the whole
	// image plane about it, so every picture feature keeps the plan point it sat under.
	return {
		at: add(pivot, mul(sub(image.transform.at, pivot), k)),
		rot: image.transform.rot,
		mPerPx: image.transform.mPerPx * k
	};
}

/** What the drawn line currently measures, before the user types the real length. */
export function measuredMetres(c: Pick<Calibration, 'a' | 'b'>): number {
	return dist(c.a, c.b);
}

/**
 * Rotate the image so the drawn line runs along a given plan bearing, for squaring
 * an underlay to north. Bearings follow `angle`: radians counter-clockwise from east.
 */
export function alignTo(image: ImageEntity, a: Vec2, b: Vec2, bearingRad: number): Transform {
	const span = sub(b, a);
	if (span.x === 0 && span.y === 0) return image.transform;
	const delta = bearingRad - angle(span);
	const pivot = lerp(a, b, 0.5);
	return {
		at: rotAround(image.transform.at, pivot, delta),
		rot: image.transform.rot + delta,
		mPerPx: image.transform.mPerPx
	};
}

/** Rotate about the image centre by a delta, for the rotation handle. */
export function rotateBy(image: ImageEntity, delta: number): Transform {
	return { ...image.transform, rot: image.transform.rot + delta };
}

/** Move the image so a given plan point lands on a given plan point, for dragging. */
export function moveBy(image: ImageEntity, delta: Vec2): Transform {
	return { ...image.transform, at: add(image.transform.at, delta) };
}

/** Plan point to a pixel coordinate inside the image, for picking a point on the picture. */
export function toPixel(image: ImageEntity, size: Size, at: Vec2): Vec2 {
	const t = image.transform;
	if (!(t.mPerPx > 0)) return { x: 0, y: 0 };
	const local = rot(sub(at, t.at), -t.rot);
	// Pixel rows run down the picture while plan y runs north, so the y term flips.
	return {
		x: local.x / t.mPerPx + size.w / 2,
		y: size.h / 2 - local.y / t.mPerPx
	};
}

export function fromPixel(image: ImageEntity, size: Size, px: Vec2): Vec2 {
	const t = image.transform;
	const local = {
		x: (px.x - size.w / 2) * t.mPerPx,
		y: (size.h / 2 - px.y) * t.mPerPx
	};
	return add(t.at, rot(local, t.rot));
}
