export type Vec2 = { x: number; y: number };

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
export const dist2 = (a: Vec2, b: Vec2): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return dx * dx + dy * dy;
};

export function norm(a: Vec2): Vec2 {
	const l = Math.hypot(a.x, a.y);
	return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Counter-clockwise perpendicular. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function rot(a: Vec2, rad: number): Vec2 {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function rotAround(a: Vec2, pivot: Vec2, rad: number): Vec2 {
	return add(pivot, rot(sub(a, pivot), rad));
}

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t
});

/** Angle in radians, measured counter-clockwise from east. */
export const angle = (a: Vec2): number => Math.atan2(a.y, a.x);

export const fromAngle = (rad: number, l = 1): Vec2 => ({
	x: Math.cos(rad) * l,
	y: Math.sin(rad) * l
});

export const eq = (a: Vec2, b: Vec2, tol = 1e-9): boolean =>
	Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

export const clone = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });

export function round(a: Vec2, step: number): Vec2 {
	return { x: Math.round(a.x / step) * step, y: Math.round(a.y / step) * step };
}

/** Closest point to `p` on segment `a`-`b`, plus its parameter along the segment. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { at: Vec2; t: number } {
	const ab = sub(b, a);
	const l2 = len2(ab);
	if (l2 === 0) return { at: clone(a), t: 0 };
	const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
	return { at: add(a, mul(ab, t)), t };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
	return dist(p, closestOnSegment(p, a, b).at);
}

/**
 * Intersection of infinite lines through `a`+`da` and `b`+`db`.
 * Returns null when they are parallel within tolerance.
 */
export function lineIntersect(a: Vec2, da: Vec2, b: Vec2, db: Vec2): Vec2 | null {
	const denom = cross(da, db);
	if (Math.abs(denom) < 1e-12) return null;
	const t = cross(sub(b, a), db) / denom;
	return add(a, mul(da, t));
}

/** Intersection of two finite segments, or null when they do not cross. */
export function segIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
	const da = sub(a2, a1);
	const db = sub(b2, b1);
	const denom = cross(da, db);
	if (Math.abs(denom) < 1e-12) return null;
	const ab = sub(b1, a1);
	const t = cross(ab, db) / denom;
	const u = cross(ab, da) / denom;
	if (t < 0 || t > 1 || u < 0 || u > 1) return null;
	return add(a1, mul(da, t));
}

export type Rect = { min: Vec2; max: Vec2 };

export const emptyRect = (): Rect => ({
	min: { x: Infinity, y: Infinity },
	max: { x: -Infinity, y: -Infinity }
});

export function rectFromPoints(pts: readonly Vec2[]): Rect {
	const r: Rect = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
	for (const p of pts) {
		if (p.x < r.min.x) r.min.x = p.x;
		if (p.y < r.min.y) r.min.y = p.y;
		if (p.x > r.max.x) r.max.x = p.x;
		if (p.y > r.max.y) r.max.y = p.y;
	}
	return r;
}

export function rectUnion(a: Rect, b: Rect): Rect {
	return {
		min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
		max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) }
	};
}

export const rectEmpty = (r: Rect): boolean => r.min.x > r.max.x || r.min.y > r.max.y;

export function rectExpand(r: Rect, by: number): Rect {
	return {
		min: { x: r.min.x - by, y: r.min.y - by },
		max: { x: r.max.x + by, y: r.max.y + by }
	};
}

export const rectContains = (r: Rect, p: Vec2): boolean =>
	p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;

export const rectOverlaps = (a: Rect, b: Rect): boolean =>
	a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;

export const rectCentre = (r: Rect): Vec2 => ({
	x: (r.min.x + r.max.x) / 2,
	y: (r.min.y + r.max.y) / 2
});
