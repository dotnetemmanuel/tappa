import { entityVertices, isClosed } from '../doc/doc.js';
import type { Doc, EntityId, NodeId } from '../doc/types.js';
import { centroid } from './polygon.js';
import { add, angle as angleOf, fromAngle, sub, type Vec2 } from './vec2.js';

export type SnapKind =
	| 'vertex'
	| 'endpoint'
	| 'midpoint'
	| 'centre'
	| 'perpendicular'
	| 'tangent'
	| 'extension'
	| 'intersection'
	| 'angle'
	| 'grid'
	| 'free';

export type SnapToggles = Record<SnapKind, boolean>;

export const DEFAULT_TOGGLES: SnapToggles = {
	vertex: true,
	endpoint: true,
	midpoint: true,
	centre: true,
	perpendicular: true,
	tangent: true,
	extension: true,
	intersection: true,
	angle: true,
	grid: true,
	free: true
};

export type SnapSettings = {
	toggles: SnapToggles;
	/** Grid spacing in metres, default 0.1 */
	grid: number;
	/** Angle lock increment in degrees, default 15 */
	angleStepDeg: number;
	/** Snap radius in metres; the caller converts a pixel tolerance into this. */
	tolerance: number;
};

export const defaultSnapSettings = (): SnapSettings => ({
	toggles: { ...DEFAULT_TOGGLES },
	grid: 0.1,
	angleStepDeg: 15,
	tolerance: 0.25
});

/** A hint the renderer draws so the user can see why a point jumped. */
export type SnapGuide =
	{ g: 'line'; a: Vec2; b: Vec2 } | { g: 'ring'; at: Vec2; r: number } | { g: 'tick'; at: Vec2 };

export type SnapRef = { entity?: EntityId; node?: NodeId; index?: number };

export type SnapResult = {
	at: Vec2;
	kind: SnapKind;
	ref?: SnapRef;
	guides: SnapGuide[];
	/** Metres from the raw cursor point to `at`. */
	d: number;
};

export type SnapContext = {
	/** The point the current segment starts from, when a draw is in progress. */
	from?: Vec2;
	/** Direction of the segment before `from`, for extension and relative angle lock. */
	prevDir?: Vec2;
	/** Shift held: constrain to horizontal or vertical from `from`. */
	ortho?: boolean;
	/** Entities to ignore, normally the one being drawn or dragged. */
	exclude?: ReadonlySet<EntityId>;
	/** Extra candidate points not yet in the document, e.g. the in-progress ring. */
	extra?: readonly Vec2[];
};

const T_VERTEX = 0;
const T_POINT = 1;
const T_ON_EDGE = 2;
const T_RAY = 3;
const T_ANGLE = 4;
const TIERS = 5;

/** A vertex counts as sitting on the ortho axis only when it is dead on it. */
const AXIS_EPS = 1e-6;

/** How far from `from` an edge may be and still offer its perpendicular direction, in tolerances. */
const NEAR_EDGE = 8;

const MAX_LINES = 8;

type Cand = {
	at: Vec2;
	kind: SnapKind;
	ref?: SnapRef;
	guides: SnapGuide[];
	d: number;
};

type LineRef = { a: Vec2; dx: number; dy: number };

type Axis = { horiz: boolean; from: Vec2 };

type Scan = {
	raw: Vec2;
	from: Vec2 | null;
	tol: number;
	on: SnapToggles;
	slots: (Cand | null)[];
	axis: Axis | null;
	lines: LineRef[];
};

export function snap(doc: Doc, raw: Vec2, ctx: SnapContext, s: SnapSettings): SnapResult {
	const from = ctx.from ?? null;
	const axis: Axis | null =
		ctx.ortho === true && from
			? { horiz: Math.abs(raw.x - from.x) >= Math.abs(raw.y - from.y), from }
			: null;

	const sc: Scan = {
		raw,
		from,
		tol: Math.max(0, s.tolerance),
		on: s.toggles,
		slots: new Array<Cand | null>(TIERS).fill(null),
		axis,
		lines: []
	};

	if (sc.tol > 0) gather(sc, doc, ctx, s);

	for (const c of sc.slots) if (c) return c;

	if (axis) {
		const at = axis.horiz ? { x: raw.x, y: axis.from.y } : { x: axis.from.x, y: raw.y };
		return {
			at,
			kind: 'angle',
			guides: [{ g: 'line', a: axis.from, b: at }],
			d: Math.hypot(at.x - raw.x, at.y - raw.y)
		};
	}

	if (s.toggles.grid && s.grid > 0) {
		const at = { x: quantize(raw.x, s.grid), y: quantize(raw.y, s.grid) };
		return { at, kind: 'grid', guides: [], d: Math.hypot(at.x - raw.x, at.y - raw.y) };
	}

	return { at: { x: raw.x, y: raw.y }, kind: 'free', guides: [], d: 0 };
}

/** Constrain a point to an exact length and/or angle typed into the HUD. */
export function constrain(
	from: Vec2,
	raw: Vec2,
	opts: { length?: number; angleRad?: number }
): Vec2 {
	const d = sub(raw, from);
	const r = opts.length ?? Math.hypot(d.x, d.y);
	const a = opts.angleRad ?? (d.x === 0 && d.y === 0 ? 0 : angleOf(d));
	return add(from, fromAngle(a, r));
}

/** Round onto the grid without leaving 4.300000000000001 behind. */
function quantize(value: number, step: number): number {
	const f = 10 ** stepDecimals(step);
	return Math.round(Math.round(value / step) * step * f) / f + 0;
}

function stepDecimals(step: number): number {
	const s = String(Math.abs(step));
	if (s.includes('e')) return 12;
	const dot = s.indexOf('.');
	return dot < 0 ? 0 : Math.min(12, s.length - dot - 1);
}

function gather(sc: Scan, doc: Doc, ctx: SnapContext, s: SnapSettings): void {
	const exclude = ctx.exclude;
	let dropped: Set<NodeId> | null = null;
	let kept: Set<NodeId> | null = null;

	for (const e of doc.entities) {
		const skipped = exclude ? exclude.has(e.id) : false;
		if (e.k === 'wall') {
			const set = skipped ? (dropped ??= new Set()) : (kept ??= new Set());
			set.add(e.a);
			set.add(e.b);
		}
		if (skipped) continue;
		const vs = entityVertices(doc, e);
		if (vs.length === 0) continue;
		scanPolyline(sc, vs, isClosed(e), e.id, e.k !== 'wall');
	}

	if (sc.on.vertex) {
		for (const id of Object.keys(doc.nodes)) {
			if (dropped?.has(id) === true && kept?.has(id) !== true) continue;
			const p = doc.nodes[id];
			offerPoint(sc, T_VERTEX, p.x, p.y, 'vertex', undefined, undefined, id);
		}
	}

	if (doc.plot.boundary.length > 0) scanPolyline(sc, doc.plot.boundary, true, undefined, true);

	if (ctx.extra && sc.on.vertex) {
		for (let i = 0; i < ctx.extra.length; i++) {
			const p = ctx.extra[i];
			offerPoint(sc, T_VERTEX, p.x, p.y, 'vertex', undefined, i);
		}
	}

	if (!sc.axis) {
		prevRay(sc, ctx);
		angleLock(sc, ctx, s);
		intersections(sc);
	}
}

function scanPolyline(
	sc: Scan,
	pts: readonly Vec2[],
	closed: boolean,
	entity: EntityId | undefined,
	includeVertices: boolean
): void {
	const n = pts.length;
	if (n === 0) return;

	if (includeVertices && sc.on.vertex) {
		for (let i = 0; i < n; i++) {
			offerPoint(sc, T_VERTEX, pts[i].x, pts[i].y, 'vertex', entity, i);
		}
	}
	if (n === 1) return;

	if (!closed && sc.on.endpoint) {
		offerPoint(sc, T_POINT, pts[0].x, pts[0].y, 'endpoint', entity, 0);
		offerPoint(sc, T_POINT, pts[n - 1].x, pts[n - 1].y, 'endpoint', entity, n - 1);
	}

	if (closed && n >= 3 && sc.on.centre) {
		const c = centroid(pts);
		offerPoint(sc, T_POINT, c.x, c.y, 'centre', entity, undefined);
	}

	const segs = closed ? n : n - 1;
	for (let i = 0; i < segs; i++) {
		scanSegment(sc, pts[i], pts[(i + 1) % n], entity, i);
	}

	if (sc.from && sc.on.tangent && !sc.axis && n >= 3) scanTangent(sc, pts, closed, entity);
}

function scanSegment(
	sc: Scan,
	a: Vec2,
	b: Vec2,
	entity: EntityId | undefined,
	index: number
): void {
	if (sc.on.midpoint) {
		offerPoint(sc, T_POINT, (a.x + b.x) / 2, (a.y + b.y) / 2, 'midpoint', entity, index);
	}
	if (sc.axis) return;

	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	if (l2 < 1e-18) return;

	const t = ((sc.raw.x - a.x) * dx + (sc.raw.y - a.y) * dy) / l2;
	const fx = a.x + dx * t;
	const fy = a.y + dy * t;
	const near = Math.hypot(sc.raw.x - fx, sc.raw.y - fy) <= sc.tol;

	if (near && sc.on.intersection && sc.lines.length < MAX_LINES) {
		sc.lines.push({ a, dx, dy });
	}

	if (near && sc.on.extension && (t < 0 || t > 1)) {
		const d = admit(sc, T_RAY, fx, fy);
		if (d >= 0) {
			const at = { x: fx, y: fy };
			sc.slots[T_RAY] = {
				at,
				kind: 'extension',
				ref: makeRef(entity, index),
				guides: [{ g: 'line', a: t < 0 ? a : b, b: at }],
				d
			};
		}
	}

	const from = sc.from;
	if (!from) return;

	if (near && sc.on.perpendicular) {
		const tf = ((from.x - a.x) * dx + (from.y - a.y) * dy) / l2;
		const px = a.x + dx * tf;
		const py = a.y + dy * tf;
		const d = admit(sc, T_ON_EDGE, px, py);
		if (d >= 0) {
			const at = { x: px, y: py };
			sc.slots[T_ON_EDGE] = {
				at,
				kind: 'perpendicular',
				ref: makeRef(entity, index),
				guides: [
					{ g: 'line', a: from, b: at },
					{ g: 'line', a, b }
				],
				d
			};
		}
	}

	if (sc.on.angle && distToSeg2(from, a, b, dx, dy, l2) <= (sc.tol * NEAR_EDGE) ** 2) {
		const r = Math.hypot(sc.raw.x - from.x, sc.raw.y - from.y);
		if (r > 1e-9) {
			const inv = 1 / Math.sqrt(l2);
			const nx = -dy * inv;
			const ny = dx * inv;
			offerAngle(sc, from, from.x + nx * r, from.y + ny * r);
			offerAngle(sc, from, from.x - nx * r, from.y - ny * r);
		}
	}
}

function offerAngle(sc: Scan, from: Vec2, x: number, y: number): void {
	const d = admit(sc, T_ANGLE, x, y);
	if (d < 0) return;
	const at = { x, y };
	sc.slots[T_ANGLE] = { at, kind: 'angle', guides: [{ g: 'line', a: from, b: at }], d };
}

/** Where the ray from `from` grazes a polyline, which is the tangent point of the curve it approximates. */
function scanTangent(
	sc: Scan,
	pts: readonly Vec2[],
	closed: boolean,
	entity: EntityId | undefined
): void {
	const f = sc.from;
	if (!f) return;
	const n = pts.length;
	const lo = closed ? 0 : 1;
	const hi = closed ? n - 1 : n - 2;
	for (let i = lo; i <= hi; i++) {
		const v = pts[i];
		const d = admit(sc, T_ON_EDGE, v.x, v.y);
		if (d < 0) continue;
		const u = pts[(i - 1 + n) % n];
		const w = pts[(i + 1) % n];
		const vx = v.x - f.x;
		const vy = v.y - f.y;
		const su = vx * (u.y - f.y) - vy * (u.x - f.x);
		const sw = vx * (w.y - f.y) - vy * (w.x - f.x);
		if (su * sw <= 0) continue;
		const at = { x: v.x, y: v.y };
		sc.slots[T_ON_EDGE] = {
			at,
			kind: 'tangent',
			ref: makeRef(entity, i),
			guides: [
				{ g: 'line', a: f, b: at },
				{ g: 'ring', at, r: sc.tol * 0.5 }
			],
			d
		};
	}
}

function prevRay(sc: Scan, ctx: SnapContext): void {
	const from = sc.from;
	const dir = ctx.prevDir;
	if (!from || !dir) return;
	const l = Math.hypot(dir.x, dir.y);
	if (l < 1e-12) return;
	const ux = dir.x / l;
	const uy = dir.y / l;

	if (sc.on.intersection && sc.lines.length < MAX_LINES) {
		sc.lines.push({ a: from, dx: ux, dy: uy });
	}
	if (!sc.on.extension) return;

	const t = (sc.raw.x - from.x) * ux + (sc.raw.y - from.y) * uy;
	if (t < 0) return;

	const d = admit(sc, T_RAY, from.x + ux * t, from.y + uy * t);
	if (d < 0) return;
	const at = { x: from.x + ux * t, y: from.y + uy * t };
	sc.slots[T_RAY] = {
		at,
		kind: 'extension',
		guides: [{ g: 'line', a: from, b: at }],
		d
	};
}

function angleLock(sc: Scan, ctx: SnapContext, s: SnapSettings): void {
	const from = sc.from;
	if (!from || !sc.on.angle) return;
	const step = (s.angleStepDeg * Math.PI) / 180;
	if (!(step > 1e-9)) return;
	const dx = sc.raw.x - from.x;
	const dy = sc.raw.y - from.y;
	const r = Math.hypot(dx, dy);
	if (r < 1e-9) return;

	const prev = ctx.prevDir;
	const base = prev && Math.hypot(prev.x, prev.y) > 1e-12 ? Math.atan2(prev.y, prev.x) : 0;
	const k = Math.round((Math.atan2(dy, dx) - base) / step);
	const locked = base + k * step;
	offerAngle(sc, from, from.x + Math.cos(locked) * r, from.y + Math.sin(locked) * r);
}

function intersections(sc: Scan): void {
	const ls = sc.lines;
	for (let i = 0; i < ls.length; i++) {
		for (let j = i + 1; j < ls.length; j++) {
			const A = ls[i];
			const B = ls[j];
			const denom = A.dx * B.dy - A.dy * B.dx;
			if (Math.abs(denom) < 1e-12) continue;
			const t = ((B.a.x - A.a.x) * B.dy - (B.a.y - A.a.y) * B.dx) / denom;
			const x = A.a.x + A.dx * t;
			const y = A.a.y + A.dy * t;
			const d = admit(sc, T_RAY, x, y);
			if (d < 0) continue;
			const at = { x, y };
			sc.slots[T_RAY] = {
				at,
				kind: 'intersection',
				guides: [
					{ g: 'line', a: A.a, b: at },
					{ g: 'line', a: B.a, b: at }
				],
				d
			};
		}
	}
}

/** The distance a candidate must beat, or -1 when it is out of range or already beaten. */
function admit(sc: Scan, tier: number, x: number, y: number): number {
	const d = Math.hypot(x - sc.raw.x, y - sc.raw.y);
	if (d > sc.tol) return -1;
	const cur = sc.slots[tier];
	if (cur && cur.d <= d) return -1;
	if (sc.axis && !onAxis(sc.axis, x, y)) return -1;
	return d;
}

function onAxis(a: Axis, x: number, y: number): boolean {
	return a.horiz ? Math.abs(y - a.from.y) <= AXIS_EPS : Math.abs(x - a.from.x) <= AXIS_EPS;
}

function offerPoint(
	sc: Scan,
	tier: number,
	x: number,
	y: number,
	kind: SnapKind,
	entity: EntityId | undefined,
	index?: number,
	node?: NodeId
): void {
	const d = admit(sc, tier, x, y);
	if (d < 0) return;
	const at = { x, y };
	const guide: SnapGuide =
		kind === 'midpoint' || kind === 'centre'
			? { g: 'tick', at }
			: { g: 'ring', at, r: sc.tol * 0.5 };
	sc.slots[tier] = { at, kind, ref: makeRef(entity, index, node), guides: [guide], d };
}

function makeRef(entity?: EntityId, index?: number, node?: NodeId): SnapRef | undefined {
	if (entity === undefined && index === undefined && node === undefined) return undefined;
	const r: SnapRef = {};
	if (entity !== undefined) r.entity = entity;
	if (index !== undefined) r.index = index;
	if (node !== undefined) r.node = node;
	return r;
}

function distToSeg2(p: Vec2, a: Vec2, b: Vec2, dx: number, dy: number, l2: number): number {
	const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
	const cx = a.x + dx * t - p.x;
	const cy = a.y + dy * t - p.y;
	return cx * cx + cy * cy;
}
