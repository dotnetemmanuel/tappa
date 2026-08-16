import {
	add,
	closestOnSegment,
	dist,
	distToSegment,
	len,
	lineIntersect,
	mul,
	norm,
	perp,
	sub,
	type Rect,
	type Vec2,
	rectFromPoints
} from './vec2.js';

/** Signed area; positive when the ring winds counter-clockwise. */
export function signedArea(ring: readonly Vec2[]): number {
	let a = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
	}
	return a / 2;
}

export const area = (ring: readonly Vec2[]): number => Math.abs(signedArea(ring));

export const isCCW = (ring: readonly Vec2[]): boolean => signedArea(ring) > 0;

export function ensureCCW(ring: readonly Vec2[]): Vec2[] {
	return isCCW(ring) ? [...ring] : [...ring].reverse();
}

/** Total length of a closed ring. */
export function perimeter(ring: readonly Vec2[]): number {
	let p = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) p += dist(ring[j], ring[i]);
	return p;
}

/** Total length of an open polyline. */
export function pathLength(pts: readonly Vec2[]): number {
	let p = 0;
	for (let i = 1; i < pts.length; i++) p += dist(pts[i - 1], pts[i]);
	return p;
}

/** Area of a ring minus its holes. Never negative. */
export function netArea(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): number {
	return Math.max(0, area(ring) - holes.reduce((s, h) => s + area(h), 0));
}

export function centroid(ring: readonly Vec2[]): Vec2 {
	const a = signedArea(ring);
	if (Math.abs(a) < 1e-12) {
		const r = rectFromPoints(ring);
		return { x: (r.min.x + r.max.x) / 2, y: (r.min.y + r.max.y) / 2 };
	}
	let cx = 0;
	let cy = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
		cx += (ring[j].x + ring[i].x) * f;
		cy += (ring[j].y + ring[i].y) * f;
	}
	return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[j];
		const b = ring[i];
		if (b.y > p.y !== a.y > p.y && p.x < ((a.x - b.x) * (p.y - b.y)) / (a.y - b.y) + b.x) {
			inside = !inside;
		}
	}
	return inside;
}

export function pointInPolygon(
	p: Vec2,
	ring: readonly Vec2[],
	holes: readonly (readonly Vec2[])[] = []
): boolean {
	if (!pointInRing(p, ring)) return false;
	return !holes.some((h) => pointInRing(p, h));
}

/** Distance from `p` to the nearest edge of a closed ring. */
export function distToRing(p: Vec2, ring: readonly Vec2[]): number {
	let best = Infinity;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		best = Math.min(best, distToSegment(p, ring[j], ring[i]));
	}
	return best;
}

/** Distance from `p` to the nearest segment of an open polyline. */
export function distToPolyline(p: Vec2, pts: readonly Vec2[]): number {
	if (pts.length === 1) return dist(p, pts[0]);
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
	return best;
}

export type PolylineHit = { at: Vec2; seg: number; t: number; d: number };

/** Nearest point on an open polyline, with the segment index and parameter that produced it. */
export function closestOnPolyline(p: Vec2, pts: readonly Vec2[]): PolylineHit | null {
	if (pts.length === 0) return null;
	if (pts.length === 1) return { at: pts[0], seg: 0, t: 0, d: dist(p, pts[0]) };
	let best: PolylineHit | null = null;
	for (let i = 1; i < pts.length; i++) {
		const c = closestOnSegment(p, pts[i - 1], pts[i]);
		const d = dist(p, c.at);
		if (!best || d < best.d) best = { at: c.at, seg: i - 1, t: c.t, d };
	}
	return best;
}

/** Same as `closestOnPolyline` but including the closing edge. */
export function closestOnRing(p: Vec2, ring: readonly Vec2[]): PolylineHit | null {
	if (ring.length < 2) return closestOnPolyline(p, ring);
	return closestOnPolyline(p, [...ring, ring[0]]);
}

export const boundsOf = (pts: readonly Vec2[]): Rect => rectFromPoints(pts);

/**
 * Ramer-Douglas-Peucker simplification, used to turn a freehand stroke into
 * something with a workable number of draggable vertices.
 */
export function simplify(pts: readonly Vec2[], tolerance: number): Vec2[] {
	if (pts.length <= 2) return [...pts];
	const keep = new Array<boolean>(pts.length).fill(false);
	keep[0] = true;
	keep[pts.length - 1] = true;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length > 0) {
		const [lo, hi] = stack.pop()!;
		let worst = -1;
		let worstD = tolerance;
		for (let i = lo + 1; i < hi; i++) {
			const d = distToSegment(pts[i], pts[lo], pts[hi]);
			if (d > worstD) {
				worstD = d;
				worst = i;
			}
		}
		if (worst >= 0) {
			keep[worst] = true;
			stack.push([lo, worst], [worst, hi]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

/** Drop consecutive duplicates, and the closing duplicate if the ring repeats its first point. */
export function dedupe(pts: readonly Vec2[], tol = 1e-7, closed = false): Vec2[] {
	const out: Vec2[] = [];
	for (const p of pts) {
		if (out.length === 0 || dist(out[out.length - 1], p) > tol) out.push({ x: p.x, y: p.y });
	}
	if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
	return out;
}

/**
 * Offset a closed ring by `d` (positive = outward for a CCW ring).
 * Miter joins, falling back to a bevel past `miterLimit` so spikes do not explode.
 */
export function offsetRing(ring: readonly Vec2[], d: number, miterLimit = 4): Vec2[] {
	const r = dedupe(ring, 1e-9, true);
	if (r.length < 3 || d === 0) return [...r];
	// The CCW perpendicular points into a CCW ring, so outward needs the opposite sign.
	const sign = isCCW(r) ? -1 : 1;
	const out: Vec2[] = [];
	for (let i = 0; i < r.length; i++) {
		const prev = r[(i - 1 + r.length) % r.length];
		const cur = r[i];
		const next = r[(i + 1) % r.length];
		const nIn = mul(perp(norm(sub(cur, prev))), sign * d);
		const nOut = mul(perp(norm(sub(next, cur))), sign * d);
		const hit = lineIntersect(add(prev, nIn), sub(cur, prev), add(cur, nOut), sub(next, cur));
		if (hit && len(sub(hit, cur)) <= Math.abs(d) * miterLimit) {
			out.push(hit);
		} else {
			out.push(add(cur, nIn), add(cur, nOut));
		}
	}
	return out;
}

/** Offset an open polyline sideways; positive `d` is to the left of travel. */
export function offsetPolyline(pts: readonly Vec2[], d: number, miterLimit = 4): Vec2[] {
	const p = dedupe(pts);
	if (p.length < 2 || d === 0) return [...p];
	const out: Vec2[] = [];
	out.push(add(p[0], mul(perp(norm(sub(p[1], p[0]))), d)));
	for (let i = 1; i < p.length - 1; i++) {
		const nIn = mul(perp(norm(sub(p[i], p[i - 1]))), d);
		const nOut = mul(perp(norm(sub(p[i + 1], p[i]))), d);
		const hit = lineIntersect(
			add(p[i - 1], nIn),
			sub(p[i], p[i - 1]),
			add(p[i], nOut),
			sub(p[i + 1], p[i])
		);
		if (hit && len(sub(hit, p[i])) <= Math.abs(d) * miterLimit) out.push(hit);
		else out.push(add(p[i], nIn), add(p[i], nOut));
	}
	const last = p.length - 1;
	out.push(add(p[last], mul(perp(norm(sub(p[last], p[last - 1]))), d)));
	return out;
}

/**
 * The outline of a path: a strip of the given width centred on the spine,
 * as a closed ring running down one side and back up the other.
 */
export function strokeToRing(spine: readonly Vec2[], width: number): Vec2[] {
	const h = width / 2;
	const left = offsetPolyline(spine, h);
	const right = offsetPolyline(spine, -h);
	return dedupe([...left, ...right.reverse()], 1e-9, true);
}

/** Resample a polyline into `n` evenly spaced points, endpoints included. */
export function samplePolyline(pts: readonly Vec2[], n: number): Vec2[] {
	if (n <= 0 || pts.length === 0) return [];
	if (pts.length === 1 || n === 1) return [{ ...pts[0] }];
	const total = pathLength(pts);
	const step = total / (n - 1);
	const out: Vec2[] = [{ ...pts[0] }];
	let seg = 1;
	let walked = 0;
	for (let i = 1; i < n - 1; i++) {
		const target = step * i;
		while (seg < pts.length && walked + dist(pts[seg - 1], pts[seg]) < target) {
			walked += dist(pts[seg - 1], pts[seg]);
			seg++;
		}
		if (seg >= pts.length) break;
		const segLen = dist(pts[seg - 1], pts[seg]);
		const t = segLen === 0 ? 0 : (target - walked) / segLen;
		out.push(add(pts[seg - 1], mul(sub(pts[seg], pts[seg - 1]), t)));
	}
	out.push({ ...pts[pts.length - 1] });
	return out;
}

/** Point and tangent at a distance along a polyline. */
export function pointAtDistance(
	pts: readonly Vec2[],
	d: number
): { at: Vec2; tangent: Vec2 } | null {
	if (pts.length < 2) return pts.length === 1 ? { at: pts[0], tangent: { x: 1, y: 0 } } : null;
	let walked = 0;
	for (let i = 1; i < pts.length; i++) {
		const segLen = dist(pts[i - 1], pts[i]);
		if (walked + segLen >= d || i === pts.length - 1) {
			const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (d - walked) / segLen));
			return {
				at: add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), t)),
				tangent: norm(sub(pts[i], pts[i - 1]))
			};
		}
		walked += segLen;
	}
	return null;
}

/** Replace a sharp corner with a fan of short segments, so paths can read as curved. */
export function filletRing(ring: readonly Vec2[], radius: number, steps = 6): Vec2[] {
	if (radius <= 0 || ring.length < 3) return [...ring];
	const out: Vec2[] = [];
	for (let i = 0; i < ring.length; i++) {
		const prev = ring[(i - 1 + ring.length) % ring.length];
		const cur = ring[i];
		const next = ring[(i + 1) % ring.length];
		const a = norm(sub(prev, cur));
		const b = norm(sub(next, cur));
		const half = Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y))) / 2;
		if (half < 1e-6 || Math.abs(half - Math.PI / 2) < 1e-6) {
			out.push(cur);
			continue;
		}
		const cut = Math.min(radius / Math.tan(half), dist(prev, cur) / 2, dist(next, cur) / 2);
		const start = add(cur, mul(a, cut));
		const end = add(cur, mul(b, cut));
		for (let s = 0; s <= steps; s++) {
			const t = s / steps;
			const p1 = add(start, mul(sub(cur, start), t));
			const p2 = add(cur, mul(sub(end, cur), t));
			out.push(add(p1, mul(sub(p2, p1), t)));
		}
	}
	return dedupe(out, 1e-9, true);
}
