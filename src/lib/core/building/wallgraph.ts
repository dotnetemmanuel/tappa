import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type * as clip from 'polygon-clipping';
import type { Doc, NodeId, WallEntity } from '../doc/types.js';
import { area, dedupe, ensureCCW, offsetRing, signedArea } from '../geom/polygon.js';
import {
	add,
	angle,
	cross,
	dist,
	dot,
	lineIntersect,
	mul,
	neg,
	norm,
	perp,
	sub,
	type Vec2
} from '../geom/vec2.js';
import { emptySolid, mergeSolids, pushVertex, type Solid } from './solid.js';

/** A closed run of walls, in order, with the node ids it passes through. */
export type WallLoop = { walls: WallEntity[]; nodes: NodeId[]; ring: Vec2[] };

const MITER_LIMIT = 4;

type Dart = { wall: WallEntity; from: NodeId; to: NodeId; ang: number };

const dartKey = (wall: string, from: NodeId): string => `${wall}|${from}`;

/** Every closed loop the wall graph contains, outer ring first. */
export function wallLoops(doc: Doc, walls?: readonly WallEntity[]): WallLoop[] {
	const src = walls ?? doc.entities.filter((e): e is WallEntity => e.k === 'wall');
	const darts = new Map<string, Dart>();
	const atNode = new Map<NodeId, Dart[]>();
	for (const w of src) {
		const a = doc.nodes[w.a];
		const b = doc.nodes[w.b];
		if (!a || !b || w.a === w.b || dist(a, b) < 1e-9) continue;
		for (const [from, to, dir] of [
			[w.a, w.b, sub(b, a)],
			[w.b, w.a, sub(a, b)]
		] as [NodeId, NodeId, Vec2][]) {
			const d: Dart = { wall: w, from, to, ang: angle(dir) };
			darts.set(dartKey(w.id, from), d);
			const list = atNode.get(from);
			if (list) list.push(d);
			else atNode.set(from, [d]);
		}
	}
	for (const list of atNode.values()) list.sort((p, q) => p.ang - q.ang);

	const nextDart = (d: Dart): Dart | null => {
		const twin = darts.get(dartKey(d.wall.id, d.to));
		const list = atNode.get(d.to);
		if (!twin || !list) return null;
		const i = list.indexOf(twin);
		return i < 0 ? null : list[(i - 1 + list.length) % list.length];
	};

	const seen = new Set<string>();
	const loops: WallLoop[] = [];
	for (const start of darts.values()) {
		if (seen.has(dartKey(start.wall.id, start.from))) continue;
		const walk: Dart[] = [];
		let cur = start;
		for (let guard = 0; guard <= darts.size; guard++) {
			const k = dartKey(cur.wall.id, cur.from);
			if (seen.has(k)) break;
			seen.add(k);
			walk.push(cur);
			const nxt = nextDart(cur);
			if (!nxt) break;
			cur = nxt;
		}
		const nodes = walk.map((d) => d.from);
		const ring = nodes.map((n) => doc.nodes[n]).filter((p): p is Vec2 => p !== undefined);
		if (ring.length !== nodes.length || ring.length < 3) continue;
		// Enclosed faces come out counter-clockwise, so this drops the outside face and spurs.
		if (signedArea(ring) <= 1e-9) continue;
		loops.push({ walls: walk.map((d) => d.wall), nodes, ring });
	}
	return loops.sort((p, q) => area(q.ring) - area(p.ring));
}

/** The building footprint: the outside face of a closed wall loop. */
export function footprintOf(doc: Doc, loop: WallLoop): Vec2[] {
	const merged = unionRings(loop.walls.map((w) => wallQuad(doc, w)));
	if (merged.length > 0) return merged[0];
	const thickest = loop.walls.reduce((t, w) => Math.max(t, w.thickness), 0);
	return offsetRing(ensureCCW(loop.ring), thickest / 2);
}

/** Outer footprint of a set of walls, merged where they touch. Empty when nothing closes. */
export function footprints(doc: Doc, walls: readonly WallEntity[]): Vec2[][] {
	const loops = wallLoops(doc, walls);
	if (loops.length === 0) return [];
	const inLoop = new Map<string, WallEntity>();
	for (const l of loops) for (const w of l.walls) inLoop.set(w.id, w);
	return unionRings([...inLoop.values()].map((w) => wallQuad(doc, w)));
}

/** Walls that meet at a node, in angular order, for mitring the corner. */
export function wallsAt(doc: Doc, n: NodeId): { wall: WallEntity; away: Vec2 }[] {
	const out: { wall: WallEntity; away: Vec2 }[] = [];
	const here = doc.nodes[n];
	if (!here) return out;
	for (const e of doc.entities) {
		if (e.k !== 'wall' || (e.a !== n && e.b !== n)) continue;
		const far = doc.nodes[e.a === n ? e.b : e.a];
		if (!far || dist(here, far) < 1e-9) continue;
		out.push({ wall: e, away: norm(sub(far, here)) });
	}
	return out.sort((p, q) => angle(p.away) - angle(q.away));
}

/** The four corners of one wall's plan rectangle, mitred against its neighbours. */
export function wallQuad(doc: Doc, wall: WallEntity): Vec2[] | null {
	const a = doc.nodes[wall.a];
	const b = doc.nodes[wall.b];
	if (!a || !b || dist(a, b) < 1e-9) return null;
	const u = norm(sub(b, a));
	const half = Math.max(wall.thickness, 1e-4) / 2;
	const na = mitrePartner(doc, wall.a, wall);
	const nb = mitrePartner(doc, wall.b, wall);
	return [
		corner(a, u, na, -half),
		corner(b, neg(u), nb, half),
		corner(b, neg(u), nb, -half),
		corner(a, u, na, half)
	];
}

/** Solid for one wall, with its openings cut out as holes in the wall face. */
export function wallSolid(doc: Doc, wall: WallEntity): Solid {
	const quad = wallQuad(doc, wall);
	const a = doc.nodes[wall.a];
	const b = doc.nodes[wall.b];
	if (!quad || !a || !b) return emptySolid();
	const height = Math.max(wall.height, 1e-3);
	const u = norm(sub(b, a));
	const length = dist(a, b);
	const parts: Solid[] = [
		faceSolid(quad, [], (p) => [p.x, 0, -p.y], true),
		faceSolid(quad, [], (p) => [p.x, height, -p.y])
	];
	for (let i = 0; i < quad.length; i++) {
		const p0 = quad[i];
		const p1 = quad[(i + 1) % quad.length];
		const long = i % 2 === 0;
		const holes = long
			? openingHoles(wall, height, length, dot(sub(p0, a), u), dot(sub(p1, a), u))
			: [];
		parts.push(sideFace(p0, p1, 0, height, holes));
	}
	return mergeSolids(parts);
}

/** Floor slab for a closed loop, at `elev`, triangulated with earcut. */
export function floorSolid(ring: readonly Vec2[], elev: number, thickness: number): Solid {
	const r = dedupe(ensureCCW(ring), 1e-9, true);
	if (r.length < 3) return emptySolid();
	const t = Math.max(thickness, 1e-3);
	const parts: Solid[] = [
		faceSolid(r, [], (p) => [p.x, elev, -p.y]),
		faceSolid(r, [], (p) => [p.x, elev - t, -p.y], true)
	];
	for (let i = 0; i < r.length; i++) {
		parts.push(sideFace(r[i], r[(i + 1) % r.length], elev - t, elev, []));
	}
	return mergeSolids(parts);
}

/** Only two walls at a node have one clean miter; three or more just butt their ends there. */
function mitrePartner(
	doc: Doc,
	n: NodeId,
	wall: WallEntity
): { away: Vec2; half: number } | null {
	const here = wallsAt(doc, n);
	if (here.length !== 2) return null;
	const other = here.find((x) => x.wall.id !== wall.id);
	return other ? { away: other.away, half: Math.max(other.wall.thickness, 1e-4) / 2 } : null;
}

function corner(
	at: Vec2,
	away: Vec2,
	other: { away: Vec2; half: number } | null,
	d: number
): Vec2 {
	const butt = add(at, mul(perp(away), d));
	if (!other) return butt;
	const side = d >= 0 ? 1 : -1;
	const hit = lineIntersect(
		butt,
		away,
		add(at, mul(perp(other.away), -side * other.half)),
		other.away
	);
	const limit = MITER_LIMIT * Math.max(Math.abs(d), other.half);
	// Past the limit this is the bevel case, and one wall on its own can only butt.
	return hit && dist(hit, at) <= limit ? hit : butt;
}

const toClipRing = (ring: readonly Vec2[]): clip.Ring => {
	const out = ring.map((p): clip.Pair => [p.x, p.y]);
	out.push([ring[0].x, ring[0].y]);
	return out;
};

const fromClipRing = (ring: clip.Ring): Vec2[] =>
	dedupe(
		ring.map(([x, y]) => ({ x, y })),
		1e-9,
		true
	);

/** Outer rings of the union of some plan shapes, largest first. */
function unionRings(rings: readonly (readonly Vec2[] | null)[]): Vec2[][] {
	const polys = rings
		.filter((r): r is Vec2[] => r !== null && r.length >= 3)
		.map((r): clip.Polygon => [toClipRing(r)]);
	if (polys.length === 0) return [];
	return polygonClipping
		.union(polys[0], ...polys.slice(1))
		.map((p) => fromClipRing(p[0]))
		.filter((r) => r.length >= 3)
		.sort((p, q) => area(q) - area(p));
}

/**
 * Triangulate a planar face and place it in the scene. Triangles come out
 * counter-clockwise in the 2D frame, so an orientation-preserving `place`
 * gives the face its outward normal.
 */
function faceSolid(
	ring: readonly Vec2[],
	holes: readonly (readonly Vec2[])[],
	place: (p: Vec2) => [number, number, number],
	flip = false
): Solid {
	const pts: Vec2[] = [];
	const flat: number[] = [];
	const holeStarts: number[] = [];
	for (const p of ring) {
		pts.push(p);
		flat.push(p.x, p.y);
	}
	for (const h of holes) {
		if (h.length < 3) continue;
		holeStarts.push(flat.length / 2);
		for (const p of h) {
			pts.push(p);
			flat.push(p.x, p.y);
		}
	}
	const raw = earcut(flat, holeStarts, 2);
	const s = emptySolid();
	for (const p of pts) {
		const [x, y, z] = place(p);
		pushVertex(s, x, y, z);
	}
	for (let i = 0; i < raw.length; i += 3) {
		const a = raw[i];
		const b = raw[i + 1];
		const c = raw[i + 2];
		const ccw = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a])) > 0;
		if (ccw !== flip) s.indices.push(a, b, c);
		else s.indices.push(a, c, b);
	}
	return s;
}

/** One upright face of a plan edge, built in a frame of distance along the edge by height. */
function sideFace(
	p0: Vec2,
	p1: Vec2,
	y0: number,
	y1: number,
	holes: readonly (readonly Vec2[])[]
): Solid {
	const l = dist(p0, p1);
	if (l < 1e-9 || y1 - y0 < 1e-9) return emptySolid();
	const ring: Vec2[] = [
		{ x: 0, y: y0 },
		{ x: l, y: y0 },
		{ x: l, y: y1 },
		{ x: 0, y: y1 }
	];
	return faceSolid(ring, holes, (q) => {
		const t = q.x / l;
		return [p0.x + (p1.x - p0.x) * t, q.y, -(p0.y + (p1.y - p0.y) * t)];
	});
}

/** Openings as clockwise holes in a side face frame, dropped when they do not fit. */
function openingHoles(
	wall: WallEntity,
	height: number,
	length: number,
	u0: number,
	u1: number
): Vec2[][] {
	const span = u1 - u0;
	if (Math.abs(span) < 1e-9 || length < 1e-9) return [];
	const faceLen = Math.abs(span);
	const dir = span >= 0 ? 1 : -1;
	const margin = 1e-3;
	const out: Vec2[][] = [];
	for (const o of wall.openings) {
		if (o.width <= 0 || o.height <= 0) continue;
		const centre = o.t * length;
		const ends = [(centre - o.width / 2 - u0) * dir, (centre + o.width / 2 - u0) * dir];
		const lo = Math.max(margin, Math.min(ends[0], ends[1]));
		const hi = Math.min(faceLen - margin, Math.max(ends[0], ends[1]));
		const y0 = Math.max(margin, o.sill);
		const y1 = Math.min(height - margin, o.sill + o.height);
		if (hi - lo < margin || y1 - y0 < margin) continue;
		out.push([
			{ x: lo, y: y0 },
			{ x: lo, y: y1 },
			{ x: hi, y: y1 },
			{ x: hi, y: y0 }
		]);
	}
	return out;
}
