import {
	emptyRect,
	add,
	lerp,
	mul,
	rectExpand,
	rectFromPoints,
	rectUnion,
	sub,
	type Rect,
	type Vec2
} from '../geom/vec2.js';
import { strokeToRing } from '../geom/polygon.js';
import { nextId } from './ids.js';
import {
	SCHEMA_VERSION,
	type Anchor,
	type Doc,
	type Entity,
	type EntityId,
	type Layer,
	type LayerId,
	type NodeId
} from './types.js';

export const DEFAULT_LAYERS: readonly Layer[] = [
	{ id: 'underlay', name: 'Underlag', visible: true, locked: true },
	{ id: 'ground', name: 'Marknivåer', visible: true, locked: false },
	{ id: 'surfaces', name: 'Ytor', visible: true, locked: false },
	{ id: 'structures', name: 'Byggnader', visible: true, locked: false },
	{ id: 'planting', name: 'Växter', visible: true, locked: false },
	{ id: 'annotation', name: 'Mått och text', visible: true, locked: false }
];

export function createDoc(name = 'Namnlös täppa'): Doc {
	const now = new Date().toISOString();
	return {
		schema: SCHEMA_VERSION,
		meta: { name, created: now, modified: now, lat: 59.4, lon: 17.9, contour: 0.25, northOffset: 0 },
		plot: { boundary: [] },
		layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
		nodes: {},
		entities: [],
		assets: []
	};
}

export function newNodeId(): NodeId {
	return nextId('node');
}

export function findEntity(doc: Doc, id: EntityId): Entity | undefined {
	return doc.entities.find((e) => e.id === id);
}

export function layerOf(doc: Doc, id: LayerId): Layer | undefined {
	return doc.layers.find((l) => l.id === id);
}

/** Can it be clicked. A locked layer hides its contents from the pointer entirely. */
export function isSelectable(doc: Doc, e: Entity): boolean {
	const l = layerOf(doc, e.layer);
	return !!l && l.visible && !l.locked;
}

/**
 * Can it be moved or reshaped. An entity lock stops the geometry changing but
 * still lets you select the thing, or there would be no way to unlock it.
 */
export function isEditable(doc: Doc, e: Entity): boolean {
	if (!isSelectable(doc, e)) return false;
	return !(e.k === 'image' && e.locked);
}

/**
 * The points a user can grab on an entity. Index order matches the entity's own
 * arrays, so a vertex anchor stays meaningful across edits.
 */
export function entityVertices(doc: Doc, e: Entity): Vec2[] {
	switch (e.k) {
		case 'area':
			return e.ring;
		case 'path':
		case 'line':
			return e.spine;
		case 'wall': {
			const a = doc.nodes[e.a];
			const b = doc.nodes[e.b];
			return a && b ? [a, b] : [];
		}
		case 'plant':
		case 'prop':
		case 'label':
		case 'spot':
			return [e.at];
		case 'image':
			return imageCorners(e.transform, assetSize(doc, e.asset));
		case 'dim':
			return [resolveAnchor(doc, e.from), resolveAnchor(doc, e.to)].filter(
				(p): p is Vec2 => p !== null
			);
		case 'roof':
			return [];
	}
}

/** True when the entity's vertex list forms a closed ring. */
export function isClosed(e: Entity): boolean {
	return e.k === 'area';
}

function assetSize(doc: Doc, id: string): { w: number; h: number } {
	const a = doc.assets.find((x) => x.id === id);
	return a ? { w: a.w, h: a.h } : { w: 1000, h: 1000 };
}

export function imageCorners(
	t: { at: Vec2; rot: number; mPerPx: number },
	size: { w: number; h: number }
): Vec2[] {
	const w = size.w * t.mPerPx;
	const h = size.h * t.mPerPx;
	const c = Math.cos(t.rot);
	const s = Math.sin(t.rot);
	const local: Vec2[] = [
		{ x: -w / 2, y: -h / 2 },
		{ x: w / 2, y: -h / 2 },
		{ x: w / 2, y: h / 2 },
		{ x: -w / 2, y: h / 2 }
	];
	return local.map((p) => ({ x: t.at.x + p.x * c - p.y * s, y: t.at.y + p.x * s + p.y * c }));
}

/** The filled outline of an entity, used for hit testing and area takeoff. */
export function entityRing(doc: Doc, e: Entity): Vec2[] | null {
	switch (e.k) {
		case 'area':
			return e.ring;
		case 'path':
			return e.spine.length >= 2 ? strokeToRing(e.spine, e.width) : null;
		case 'line':
			return e.spine.length >= 2 ? strokeToRing(e.spine, Math.max(e.thickness, 0.05)) : null;
		case 'wall': {
			const a = doc.nodes[e.a];
			const b = doc.nodes[e.b];
			return a && b ? strokeToRing([a, b], e.thickness) : null;
		}
		case 'image':
			return imageCorners(e.transform, assetSize(doc, e.asset));
		default:
			return null;
	}
}

export function entityBounds(doc: Doc, e: Entity): Rect {
	switch (e.k) {
		case 'plant':
			return rectExpand(rectFromPoints([e.at]), 1.5);
		case 'prop':
			return rectExpand(rectFromPoints([e.at]), 1 * (e.scale ?? 1));
		case 'label':
			return rectExpand(rectFromPoints([e.at]), e.size * Math.max(2, e.text.length * 0.4));
		case 'spot':
			return rectExpand(rectFromPoints([e.at]), 0.3);
		case 'roof': {
			let r = emptyRect();
			for (const id of e.over) {
				const covered = findEntity(doc, id);
				if (covered) r = rectUnion(r, entityBounds(doc, covered));
			}
			return rectExpand(r, e.overhang);
		}
		default: {
			const ring = entityRing(doc, e);
			if (ring && ring.length > 0) return rectFromPoints(ring);
			const vs = entityVertices(doc, e);
			return vs.length > 0 ? rectFromPoints(vs) : emptyRect();
		}
	}
}

export function docBounds(doc: Doc): Rect {
	let r = doc.plot.boundary.length > 0 ? rectFromPoints(doc.plot.boundary) : emptyRect();
	for (const e of doc.entities) r = rectUnion(r, entityBounds(doc, e));
	return r;
}

/** Resolve an anchor to a coordinate, or null when the geometry it named is gone. */
export function resolveAnchor(doc: Doc, a: Anchor): Vec2 | null {
	switch (a.k) {
		case 'free':
			return a.at;
		case 'node':
			return doc.nodes[a.n] ?? null;
		case 'vertex': {
			const e = findEntity(doc, a.e);
			if (!e) return null;
			const vs = entityVertices(doc, e);
			return vs[a.i] ?? null;
		}
		case 'edge': {
			const e = findEntity(doc, a.e);
			if (!e) return null;
			const vs = entityVertices(doc, e);
			if (vs.length < 2) return null;
			const closed = isClosed(e);
			const count = closed ? vs.length : vs.length - 1;
			if (a.i < 0 || a.i >= count) return null;
			return lerp(vs[a.i], vs[(a.i + 1) % vs.length], a.t);
		}
	}
}

/** Anchors that could not resolve are dropped, so callers get a clean pair or nothing. */
export function resolveAnchorPair(doc: Doc, from: Anchor, to: Anchor): [Vec2, Vec2] | null {
	const a = resolveAnchor(doc, from);
	const b = resolveAnchor(doc, to);
	return a && b ? [a, b] : null;
}

export function translateAnchor(a: Anchor, by: Vec2): Anchor {
	return a.k === 'free' ? { k: 'free', at: add(a.at, by) } : a;
}

/**
 * Move an entity bodily. Wall entities are excluded: they move by their nodes,
 * which is what keeps a corner shared between two walls.
 */
export function translateEntity(e: Entity, by: Vec2): Entity {
	const m = (p: Vec2) => add(p, by);
	switch (e.k) {
		case 'area':
			return { ...e, ring: e.ring.map(m), holes: e.holes?.map((h) => h.map(m)) };
		case 'path':
		case 'line':
			return { ...e, spine: e.spine.map(m) };
		case 'plant':
		case 'prop':
		case 'label':
		case 'spot':
			return { ...e, at: m(e.at) };
		case 'image':
			return { ...e, transform: { ...e.transform, at: m(e.transform.at) } };
		case 'dim':
			return { ...e, from: translateAnchor(e.from, by), to: translateAnchor(e.to, by) };
		case 'wall':
		case 'roof':
			return e;
	}
}

export function rotateEntity(e: Entity, pivot: Vec2, rad: number): Entity {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	const m = (p: Vec2): Vec2 => {
		const d = sub(p, pivot);
		return add(pivot, { x: d.x * c - d.y * s, y: d.x * s + d.y * c });
	};
	switch (e.k) {
		case 'area':
			return { ...e, ring: e.ring.map(m), holes: e.holes?.map((h) => h.map(m)) };
		case 'path':
		case 'line':
			return { ...e, spine: e.spine.map(m) };
		case 'plant':
		case 'prop':
			return { ...e, at: m(e.at), rot: e.rot + rad };
		case 'label':
			return { ...e, at: m(e.at), rot: (e.rot ?? 0) + rad };
		case 'spot':
			return { ...e, at: m(e.at) };
		case 'image':
			return {
				...e,
				transform: { ...e.transform, at: m(e.transform.at), rot: e.transform.rot + rad }
			};
		case 'dim':
			return {
				...e,
				from: e.from.k === 'free' ? { k: 'free', at: m(e.from.at) } : e.from,
				to: e.to.k === 'free' ? { k: 'free', at: m(e.to.at) } : e.to
			};
		case 'wall':
		case 'roof':
			return e;
	}
}

/** Replace vertex `i`, for the vertex-drag path. Returns the entity unchanged when `i` is out of range. */
export function setVertex(e: Entity, i: number, at: Vec2): Entity {
	const put = (pts: Vec2[]): Vec2[] => pts.map((p, j) => (j === i ? at : p));
	switch (e.k) {
		case 'area':
			return i < e.ring.length ? { ...e, ring: put(e.ring) } : e;
		case 'path':
		case 'line':
			return i < e.spine.length ? { ...e, spine: put(e.spine) } : e;
		case 'plant':
		case 'prop':
		case 'label':
		case 'spot':
			return i === 0 ? { ...e, at } : e;
		case 'image':
			return e;
		default:
			return e;
	}
}

/** Nodes no wall references any more, so a delete does not leave orphans behind. */
export function orphanNodes(doc: Doc): NodeId[] {
	const used = new Set<NodeId>();
	for (const e of doc.entities) {
		if (e.k === 'wall') {
			used.add(e.a);
			used.add(e.b);
		}
	}
	return Object.keys(doc.nodes).filter((n) => !used.has(n));
}

export function wallsAtNode(doc: Doc, n: NodeId): Entity[] {
	return doc.entities.filter((e) => e.k === 'wall' && (e.a === n || e.b === n));
}

/** Points evenly spaced along a spine, for array-along-path. */
export function spacePoints(spine: readonly Vec2[], count: number, inset = 0): Vec2[] {
	if (count < 1 || spine.length < 2) return [];
	const out: Vec2[] = [];
	let total = 0;
	for (let i = 1; i < spine.length; i++)
		total += Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y);
	const usable = Math.max(0, total - inset * 2);
	const step = count === 1 ? 0 : usable / (count - 1);
	for (let i = 0; i < count; i++) {
		const target = inset + step * i;
		let walked = 0;
		for (let s = 1; s < spine.length; s++) {
			const segLen = Math.hypot(spine[s].x - spine[s - 1].x, spine[s].y - spine[s - 1].y);
			if (walked + segLen >= target || s === spine.length - 1) {
				const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (target - walked) / segLen));
				out.push(add(spine[s - 1], mul(sub(spine[s], spine[s - 1]), t)));
				break;
			}
			walked += segLen;
		}
	}
	return out;
}
