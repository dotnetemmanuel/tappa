import { entityBounds, entityRing, entityVertices, isClosed, isEditable } from '../doc/doc.js';
import type { Doc, Entity, EntityId, EntityKind, NodeId } from '../doc/types.js';
import { pointInPolygon } from './polygon.js';
import {
	closestOnSegment,
	dist,
	rectContains,
	rectExpand,
	rectFromPoints,
	rectOverlaps,
	segIntersect,
	type Rect,
	type Vec2
} from './vec2.js';

export type PickPart =
	| { part: 'vertex'; index: number }
	| { part: 'edge'; index: number; t: number }
	| { part: 'body' }
	| { part: 'node'; node: NodeId };

export type Pick = {
	entity: Entity;
	/** Metres from the query point to whatever was hit. */
	d: number;
} & PickPart;

export type PickOptions = {
	/** Pick radius in metres; the caller converts a pixel tolerance into this. */
	tolerance: number;
	/** Only these kinds are considered when present. */
	kinds?: ReadonlySet<EntityKind>;
	exclude?: ReadonlySet<EntityId>;
	/** Skip entities on hidden or locked layers. Default true. */
	respectLayers?: boolean;
	/** Only look at these entity ids, used to pick parts of the current selection. */
	only?: ReadonlySet<EntityId>;
};

const POINT_LIKE: ReadonlySet<EntityKind> = new Set<EntityKind>(['plant', 'prop', 'label']);

/** Two handles this close together are the same click, so draw order decides. */
const NEAR_TIE = 1e-9;

type Cand = { pick: Pick; z: number };

function partRank(p: PickPart): number {
	switch (p.part) {
		case 'vertex':
		case 'node':
			return 0;
		case 'edge':
			return 1;
		case 'body':
			return 2;
	}
}

function byQuality(a: Cand, b: Cand): number {
	const ra = partRank(a.pick);
	const rb = partRank(b.pick);
	if (ra !== rb) return ra - rb;
	// A fill is picked by what is drawn on top, a handle by what is nearest.
	if (ra === 2) return b.z - a.z || a.pick.d - b.pick.d;
	if (Math.abs(a.pick.d - b.pick.d) > NEAR_TIE) return a.pick.d - b.pick.d;
	return b.z - a.z;
}

function edgeCount(vs: readonly Vec2[], closed: boolean): number {
	if (vs.length < 2) return 0;
	return closed && vs.length > 2 ? vs.length : vs.length - 1;
}

function considered(doc: Doc, e: Entity, o: Omit<PickOptions, 'tolerance'>): boolean {
	if (o.only && !o.only.has(e.id)) return false;
	if (o.exclude?.has(e.id)) return false;
	if (o.kinds && !o.kinds.has(e.k)) return false;
	if (o.respectLayers !== false && !isEditable(doc, e)) return false;
	return true;
}

function hitsFor(doc: Doc, e: Entity, at: Vec2, tolerance: number): Pick[] {
	const out: Pick[] = [];
	const vs = entityVertices(doc, e);

	for (let i = 0; i < vs.length; i++) {
		const d = dist(at, vs[i]);
		if (d > tolerance) continue;
		// A wall vertex is a shared node; dragging the wall array itself would move nothing.
		if (e.k === 'wall') out.push({ entity: e, d, part: 'node', node: i === 0 ? e.a : e.b });
		else out.push({ entity: e, d, part: 'vertex', index: i });
	}

	const segs = edgeCount(vs, isClosed(e));
	for (let i = 0; i < segs; i++) {
		const c = closestOnSegment(at, vs[i], vs[(i + 1) % vs.length]);
		const d = dist(at, c.at);
		if (d <= tolerance) out.push({ entity: e, d, part: 'edge', index: i, t: c.t });
	}

	if (POINT_LIKE.has(e.k)) {
		if (vs.length > 0) {
			const d = dist(at, vs[0]);
			if (d <= tolerance) out.push({ entity: e, d, part: 'body' });
		}
		return out;
	}

	const ring = entityRing(doc, e);
	if (ring && ring.length >= 3) {
		const holes = e.k === 'area' ? (e.holes ?? []) : [];
		// Standing on a fill is a zero-distance hit, whatever the query point.
		if (pointInPolygon(at, ring, holes)) out.push({ entity: e, d: 0, part: 'body' });
	}
	return out;
}

/** Every hit, best first, for alt-click cycling through overlapping things. */
export function pickAll(doc: Doc, at: Vec2, o: PickOptions): Pick[] {
	const all: Cand[] = [];
	doc.entities.forEach((e, z) => {
		if (!considered(doc, e, o)) return;
		if (!rectContains(rectExpand(entityBounds(doc, e), o.tolerance), at)) return;
		for (const p of hitsFor(doc, e, at, o.tolerance)) all.push({ pick: p, z });
	});
	all.sort(byQuality);

	const seen = new Set<EntityId>();
	const out: Pick[] = [];
	for (const c of all) {
		if (seen.has(c.pick.entity.id)) continue;
		seen.add(c.pick.entity.id);
		out.push(c.pick);
	}
	return out;
}

/** The single best pick, or null. Vertices beat edges, edges beat bodies. */
export function pick(doc: Doc, at: Vec2, o: PickOptions): Pick | null {
	return pickAll(doc, at, o)[0] ?? null;
}

function rectCorners(r: Rect): Vec2[] {
	return [r.min, { x: r.max.x, y: r.min.y }, r.max, { x: r.min.x, y: r.max.y }];
}

function touchesRect(vs: readonly Vec2[], closed: boolean, r: Rect): boolean {
	if (vs.some((p) => rectContains(r, p))) return true;
	const corners = rectCorners(r);
	const segs = edgeCount(vs, closed);
	for (let i = 0; i < segs; i++) {
		const a = vs[i];
		const b = vs[(i + 1) % vs.length];
		for (let c = 0; c < 4; c++) {
			if (segIntersect(a, b, corners[c], corners[(c + 1) % 4])) return true;
		}
	}
	return false;
}

/** Entities inside (crossing = false) or touching (crossing = true) a rectangle. */
export function pickInRect(
	doc: Doc,
	r: Rect,
	o: { crossing: boolean; kinds?: ReadonlySet<EntityKind>; respectLayers?: boolean }
): Entity[] {
	// A drag can hand us a rect built corner to corner, in any direction.
	const box = rectFromPoints([r.min, r.max]);
	const out: Entity[] = [];
	for (const e of doc.entities) {
		if (o.kinds && !o.kinds.has(e.k)) continue;
		if (o.respectLayers !== false && !isEditable(doc, e)) continue;
		const vs = entityVertices(doc, e);
		if (vs.length === 0) continue;
		if (o.crossing) {
			if (!rectOverlaps(entityBounds(doc, e), box)) continue;
			if (touchesRect(vs, isClosed(e), box)) out.push(e);
		} else if (vs.every((p) => rectContains(box, p))) {
			out.push(e);
		}
	}
	return out;
}

/** Nearest wall node, for dragging a shared house corner. */
export function pickNode(
	doc: Doc,
	at: Vec2,
	tolerance: number
): { node: NodeId; at: Vec2; d: number } | null {
	let best: { node: NodeId; at: Vec2; d: number } | null = null;
	for (const [node, p] of Object.entries(doc.nodes)) {
		const d = dist(at, p);
		if (d <= tolerance && (best === null || d < best.d)) best = { node, at: { ...p }, d };
	}
	return best;
}

/** Nearest point on the plot boundary ring, with the vertex or edge it belongs to. */
export function pickPlot(
	doc: Doc,
	at: Vec2,
	tolerance: number
):
	| { part: 'vertex'; index: number; at: Vec2; d: number }
	| { part: 'edge'; index: number; t: number; at: Vec2; d: number }
	| null {
	const ring = doc.plot.boundary;
	let bestV: { part: 'vertex'; index: number; at: Vec2; d: number } | null = null;
	for (let i = 0; i < ring.length; i++) {
		const d = dist(at, ring[i]);
		if (d <= tolerance && (bestV === null || d < bestV.d)) {
			bestV = { part: 'vertex', index: i, at: { ...ring[i] }, d };
		}
	}
	if (bestV) return bestV;

	let bestE: { part: 'edge'; index: number; t: number; at: Vec2; d: number } | null = null;
	const segs = edgeCount(ring, true);
	for (let i = 0; i < segs; i++) {
		const c = closestOnSegment(at, ring[i], ring[(i + 1) % ring.length]);
		const d = dist(at, c.at);
		if (d <= tolerance && (bestE === null || d < bestE.d)) {
			bestE = { part: 'edge', index: i, t: c.t, at: c.at, d };
		}
	}
	return bestE;
}
