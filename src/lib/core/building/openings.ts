import type { Doc, Opening, WallEntity } from '../doc/types.js';
import {
	add,
	closestOnSegment,
	dist,
	mul,
	neg,
	norm,
	perp,
	sub,
	type Vec2
} from '../geom/vec2.js';
import { emptySolid, pushVertex, type Solid } from './solid.js';

/** Where an opening sits in world space, for drawing it in plan and in 3D. */
export type OpeningPlacement = {
	centre: Vec2;
	along: Vec2;
	normal: Vec2;
	width: number;
	height: number;
	sill: number;
	type: 'door' | 'window';
};

/** Default sizes in metres. */
export const DEFAULT_DOOR: { width: number; height: number; sill: number } = {
	width: 0.9,
	height: 2.1,
	sill: 0
};

export const DEFAULT_WINDOW: { width: number; height: number; sill: number } = {
	width: 1.2,
	height: 1.2,
	sill: 0.9
};

const DOOR_INSET = 0.03;
const GLASS_INSET = 0.06;

export function placeOpening(doc: Doc, wall: WallEntity, o: Opening): OpeningPlacement | null {
	const a = doc.nodes[wall.a];
	const b = doc.nodes[wall.b];
	if (!a || !b || dist(a, b) < 1e-9) return null;
	if (o.width <= 0 || o.height <= 0) return null;
	const along = norm(sub(b, a));
	return {
		centre: add(a, mul(sub(b, a), o.t)),
		along,
		normal: perp(along),
		width: o.width,
		height: o.height,
		sill: o.sill,
		type: o.type
	};
}

export function placements(doc: Doc, wall: WallEntity): OpeningPlacement[] {
	return wall.openings
		.map((o) => placeOpening(doc, wall, o))
		.filter((p): p is OpeningPlacement => p !== null);
}

/** Turn a click near a wall into a `t` along it, clamped so the opening stays on the wall. */
export function tForPoint(doc: Doc, wall: WallEntity, at: Vec2, width: number): number {
	const a = doc.nodes[wall.a];
	const b = doc.nodes[wall.b];
	if (!a || !b) return 0.5;
	const length = dist(a, b);
	if (length < 1e-9 || width >= length) return 0.5;
	const half = width / 2 / length;
	const t = closestOnSegment(at, a, b).t;
	return Math.min(1 - half, Math.max(half, t));
}

/** True when two openings on the same wall would overlap. */
export function overlaps(a: Opening, b: Opening, wallLength: number): boolean {
	if (a.id === b.id) return false;
	const gap = Math.abs(a.t * wallLength - b.t * wallLength);
	return gap < (a.width + b.width) / 2 - 1e-9;
}

/** Solid for the reveal and glass of one opening, so a window reads as a window in 3D. */
export function openingSolid(p: OpeningPlacement, wallThickness: number): Solid {
	const s = emptySolid();
	if (p.width <= 0 || p.height <= 0) return s;
	const halfT = Math.max(wallThickness, 1e-3) / 2;
	const halfW = p.width / 2;
	const y0 = p.sill;
	const y1 = p.sill + p.height;

	const at = (along: number, across: number, y: number): Xyz => {
		const q = add(add(p.centre, mul(p.along, along)), mul(p.normal, across));
		return [q.x, y, -q.y];
	};
	const dir = (d: Vec2): Xyz => [d.x, 0, -d.y];

	const jamb = (side: number, faces: Vec2) =>
		facet(
			s,
			[
				at(side * halfW, halfT, y0),
				at(side * halfW, -halfT, y0),
				at(side * halfW, -halfT, y1),
				at(side * halfW, halfT, y1)
			],
			dir(faces)
		);
	jamb(-1, p.along);
	jamb(1, neg(p.along));

	const band = (y: number, up: Xyz) =>
		facet(s, [at(-halfW, halfT, y), at(halfW, halfT, y), at(halfW, -halfT, y), at(-halfW, -halfT, y)], up);
	band(y1, [0, -1, 0]);
	band(y0, [0, 1, 0]);

	const inset = p.type === 'window' ? GLASS_INSET : DOOR_INSET;
	const pw = halfW - inset;
	const py0 = y0 + inset;
	const py1 = y1 - inset;
	if (pw > 0 && py1 - py0 > 1e-6) {
		const pane: Xyz[] = [at(-pw, 0, py0), at(pw, 0, py0), at(pw, 0, py1), at(-pw, 0, py1)];
		facet(s, pane, dir(p.normal));
		facet(s, pane, dir(neg(p.normal)));
	}
	return s;
}

type Xyz = [number, number, number];

/** Fan-triangulate a flat convex outline, reversing it when it faces the wrong way. */
function facet(s: Solid, pts: readonly Xyz[], want: Xyz): void {
	if (pts.length < 3) return;
	const [a, b, c] = pts;
	const u: Xyz = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const w: Xyz = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	const n: Xyz = [
		u[1] * w[2] - u[2] * w[1],
		u[2] * w[0] - u[0] * w[2],
		u[0] * w[1] - u[1] * w[0]
	];
	const order = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0 ? [...pts].reverse() : pts;
	const base = s.positions.length / 3;
	for (const q of order) pushVertex(s, q[0], q[1], q[2]);
	for (let i = 2; i < order.length; i++) s.indices.push(base, base + i - 1, base + i);
}
