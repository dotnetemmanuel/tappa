import type { Rect, Vec2 } from '../core/geom/vec2.js';

/**
 * The plan camera. `scale` is CSS pixels per metre; `centre` is the world point
 * under the middle of the viewport. World y is north, screen y grows downward,
 * so the y axis flips here and nowhere else.
 */
export type View = {
	centre: Vec2;
	scale: number;
	/** Viewport size in CSS pixels. */
	w: number;
	h: number;
};

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 600;

export const createView = (w = 1, h = 1): View => ({ centre: { x: 0, y: 0 }, scale: 30, w, h });

export function toScreen(view: View, p: Vec2): Vec2 {
	return {
		x: view.w / 2 + (p.x - view.centre.x) * view.scale,
		y: view.h / 2 - (p.y - view.centre.y) * view.scale
	};
}

export function toWorld(view: View, p: Vec2): Vec2 {
	return {
		x: view.centre.x + (p.x - view.w / 2) / view.scale,
		y: view.centre.y - (p.y - view.h / 2) / view.scale
	};
}

/** Metres per CSS pixel, for turning a pixel tolerance into a world tolerance. */
export const perPixel = (view: View): number => 1 / view.scale;

export function zoomAt(view: View, screen: Vec2, factor: number): View {
	const before = toWorld(view, screen);
	const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
	const after = toWorld({ ...view, scale }, screen);
	return {
		...view,
		scale,
		centre: { x: view.centre.x + before.x - after.x, y: view.centre.y + before.y - after.y }
	};
}

export function panBy(view: View, screenDelta: Vec2): View {
	return {
		...view,
		centre: {
			x: view.centre.x - screenDelta.x / view.scale,
			y: view.centre.y + screenDelta.y / view.scale
		}
	};
}

/** The world rectangle currently visible, useful for culling. */
export function visibleRect(view: View): Rect {
	const halfW = view.w / 2 / view.scale;
	const halfH = view.h / 2 / view.scale;
	return {
		min: { x: view.centre.x - halfW, y: view.centre.y - halfH },
		max: { x: view.centre.x + halfW, y: view.centre.y + halfH }
	};
}

export function fitTo(view: View, r: Rect, padPx = 64): View {
	if (!Number.isFinite(r.min.x) || r.max.x < r.min.x) return view;
	const w = Math.max(r.max.x - r.min.x, 1);
	const h = Math.max(r.max.y - r.min.y, 1);
	const scale = Math.min(
		MAX_SCALE,
		Math.max(MIN_SCALE, Math.min((view.w - padPx * 2) / w, (view.h - padPx * 2) / h))
	);
	return {
		...view,
		scale,
		centre: { x: (r.min.x + r.max.x) / 2, y: (r.min.y + r.max.y) / 2 }
	};
}

/** Grid spacing that keeps lines readable at the current zoom. */
export function gridStep(view: View): { minor: number; major: number } {
	const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
	const minor = candidates.find((c) => c * view.scale >= 18) ?? 100;
	return { minor, major: minor * 5 };
}
