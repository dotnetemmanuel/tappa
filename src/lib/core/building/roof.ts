import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import type * as clip from 'polygon-clipping';
import { entityRing, findEntity } from '../doc/doc.js';
import type { Doc, RoofEntity, WallEntity } from '../doc/types.js';
import { area, dedupe, ensureCCW, offsetRing } from '../geom/polygon.js';
import { rot, type Vec2 } from '../geom/vec2.js';
import { emptySolid, mergeSolids, pushQuad, pushVertex, type Solid } from './solid.js';
import { footprints } from './wallgraph.js';

export type RoofResult = { solid: Solid; ridgeHeight: number; eaveHeight: number; outline: Vec2[] };

/** Nothing covered is a wall, so there is no wall top to take an eave height from. */
const DEFAULT_EAVE = 2.4;
const ROOF_THICKNESS = 0.18;
const MAX_PITCH_DEG = 85;

type Box = { xMin: number; xMax: number; qMin: number; qMax: number };

/** A line `a*x + b*y = c` in the ridge-aligned frame, where the roof surface creases. */
type Crease = { a: number; b: number; c: number };

type Frame = {
	theta: number;
	/** World plan outline including overhang, counter-clockwise. */
	outline: Vec2[];
	/** The same outline rotated so the ridge runs along x. */
	local: Vec2[];
	box: Box;
	eave: number;
	rise: number;
	height: (p: Vec2) => number;
};

/** Build a roof over the footprint of the entities it covers. Null when there is no closed footprint. */
export function buildRoof(doc: Doc, roof: RoofEntity): RoofResult | null {
	const base = frameOf(doc, roof);
	if (!base) return null;
	const split = regionsOf(base, roof.type);
	// The clipper could not cut this footprint, and a flat slab beats a wrong gable.
	const f = split ? base : { ...base, rise: 0, height: () => base.eave };
	const regions = split ?? [{ ring: base.local, holes: [] as Vec2[][] }];
	const type = split ? roof.type : 'flat';
	const back = (p: Vec2): Vec2 => rot(p, f.theta);
	const parts: Solid[] = [];

	for (const region of regions) {
		const mesh = triangulate(region.ring, region.holes);
		parts.push(surface(mesh, (p) => f.height(p) + ROOF_THICKNESS, back, true));
		parts.push(surface(mesh, f.height, back, false));
	}

	const edge = splitAtCreases(f.local, creasesOf(f, type));
	for (let i = 0; i < edge.length; i++) {
		const p = edge[i];
		const q = edge[(i + 1) % edge.length];
		const hp = f.height(p);
		const hq = f.height(q);
		parts.push(strip(back(p), back(q), hp, hq, hp + ROOF_THICKNESS, hq + ROOF_THICKNESS));
		// Where the surface stands clear of the eave this fills in, which is the gable wall.
		if (hp > f.eave + 1e-6 || hq > f.eave + 1e-6) {
			parts.push(strip(back(p), back(q), f.eave, f.eave, hp, hq));
		}
	}

	return {
		solid: mergeSolids(parts),
		ridgeHeight: f.eave + f.rise,
		eaveHeight: f.eave,
		outline: f.outline
	};
}

/** The plan outline including overhang, for drawing the roof edge on the plan. */
export function roofOutline(doc: Doc, roof: RoofEntity): Vec2[] | null {
	return frameOf(doc, roof)?.outline ?? null;
}

/** Ridge line in plan, for showing the ridge direction while the user drags it. */
export function ridgeLine(doc: Doc, roof: RoofEntity): [Vec2, Vec2] | null {
	const f = frameOf(doc, roof);
	if (!f) return null;
	const { xMin, xMax, qMin, qMax } = f.box;
	const qMid = (qMin + qMax) / 2;
	const back = (x: number, y: number): Vec2 => rot({ x, y }, f.theta);
	switch (roof.type) {
		case 'flat':
			return null;
		case 'mono':
			return [back(xMax, qMin), back(xMax, qMax)];
		case 'gable':
			return [back(xMin, qMid), back(xMax, qMid)];
		case 'hip': {
			const a = xMax - xMin;
			const b = qMax - qMin;
			if (a >= b) return [back(xMin + b / 2, qMid), back(xMax - b / 2, qMid)];
			const xMid = (xMin + xMax) / 2;
			return [back(xMid, qMin + a / 2), back(xMid, qMax - a / 2)];
		}
	}
}

function frameOf(doc: Doc, roof: RoofEntity): Frame | null {
	const base = mergeOutline(coveredRings(doc, roof));
	if (!base) return null;
	const overhang = Math.max(0, roof.overhang);
	// The union cleans up any fold the offset leaves at a tight corner.
	const grown = overhang > 0 ? mergeOutline([offsetRing(base, overhang)]) : base;
	if (!grown || grown.length < 3) return null;
	const outline = ensureCCW(grown);
	const theta = (roof.ridgeDeg * Math.PI) / 180;
	const local = outline.map((p) => rot(p, -theta));
	const box = boxOf(local);
	if (box.xMax - box.xMin < 1e-6 || box.qMax - box.qMin < 1e-6) return null;
	const eave = eaveHeightOf(doc, roof);
	const pitch = (Math.min(Math.max(roof.pitchDeg, 0), MAX_PITCH_DEG) * Math.PI) / 180;
	const { height, rise } = heightOf(roof.type, box, eave, Math.tan(pitch));
	return { theta, outline, local, box, eave, rise, height };
}

function heightOf(
	type: RoofEntity['type'],
	box: Box,
	eave: number,
	tan: number
): { height: (p: Vec2) => number; rise: number } {
	const a = box.xMax - box.xMin;
	const b = box.qMax - box.qMin;
	const qMid = (box.qMin + box.qMax) / 2;
	switch (type) {
		case 'flat':
			return { height: () => eave, rise: 0 };
		case 'mono':
			// `ridgeDeg` points at the high side, so height climbs along the rotated x axis.
			return { height: (p) => eave + (p.x - box.xMin) * tan, rise: a * tan };
		case 'gable':
			return {
				height: (p) => eave + Math.max(0, b / 2 - Math.abs(p.y - qMid)) * tan,
				rise: (b / 2) * tan
			};
		case 'hip':
			return {
				height: (p) =>
					eave +
					Math.max(
						0,
						Math.min(p.y - box.qMin, box.qMax - p.y, p.x - box.xMin, box.xMax - p.x)
					) *
						tan,
				rise: (Math.min(a, b) / 2) * tan
			};
	}
}

function eaveHeightOf(doc: Doc, roof: RoofEntity): number {
	let tallest = -Infinity;
	for (const id of roof.over) {
		const e = findEntity(doc, id);
		// The eave rides on the finished floor, so a house dug into a slope takes its roof down with it.
		if (e && e.k === 'wall') tallest = Math.max(tallest, (e.floor ?? 0) + e.height);
	}
	return Number.isFinite(tallest) ? tallest : DEFAULT_EAVE;
}

function coveredRings(doc: Doc, roof: RoofEntity): Vec2[][] {
	const walls: WallEntity[] = [];
	const rings: Vec2[][] = [];
	for (const id of roof.over) {
		const e = findEntity(doc, id);
		if (!e) continue;
		if (e.k === 'wall') {
			walls.push(e);
			continue;
		}
		const r = entityRing(doc, e);
		if (r) rings.push(dedupe(r, 1e-9, true));
	}
	if (walls.length > 0) rings.push(...footprints(doc, walls));
	return rings.filter((r) => r.length >= 3);
}

/**
 * The covered shapes merged into one outline. Only the largest piece survives, so a
 * roof named over two separate buildings covers the bigger one.
 */
function mergeOutline(rings: readonly (readonly Vec2[])[]): Vec2[] | null {
	const polys = rings
		.filter((r) => r.length >= 3)
		.map((r): clip.Polygon => [toClipRing(r)]);
	if (polys.length === 0) return null;
	let best: Vec2[] | null = null;
	for (const poly of polygonClipping.union(polys[0], ...polys.slice(1))) {
		const ring = fromClipRing(poly[0]);
		if (ring.length >= 3 && (!best || area(ring) > area(best))) best = ring;
	}
	return best;
}

/**
 * The footprint cut into pieces on which the roof surface is a single plane, so
 * triangulating and lifting each vertex reproduces the ridge as a real crease even
 * when the footprint is an L.
 */
function regionsOf(
	f: Frame,
	type: RoofEntity['type']
): { ring: Vec2[]; holes: Vec2[][] }[] | null {
	const pads = padsOf(f.box, type);
	if (pads.length === 0) return [{ ring: f.local, holes: [] }];
	const subject: clip.Polygon = [toClipRing(f.local)];
	const out: { ring: Vec2[]; holes: Vec2[][] }[] = [];
	for (const pad of pads) {
		if (pad.length < 3) continue;
		let pieces: clip.MultiPolygon;
		try {
			pieces = polygonClipping.intersection(subject, [toClipRing(pad)]);
		} catch {
			return null;
		}
		for (const poly of pieces) {
			const ring = fromClipRing(poly[0]);
			if (ring.length < 3) continue;
			const holes = poly
				.slice(1)
				.map(fromClipRing)
				.filter((h) => h.length >= 3);
			out.push({ ring, holes });
		}
	}
	return out;
}

/**
 * Cutting shapes, one per plane the roof surface has. Only the creases between them
 * are exact: the outside edges run well clear of the footprint, because a cut that
 * lies along a footprint edge is what breaks the clipper.
 */
function padsOf(box: Box, type: RoofEntity['type']): Vec2[][] {
	const { xMin, xMax, qMin, qMax } = box;
	const qMid = (qMin + qMax) / 2;
	const m = Math.max(xMax - xMin, qMax - qMin) + 1;
	const lo = { x: xMin - m, y: qMin - m };
	const hi = { x: xMax + m, y: qMax + m };
	const p = (x: number, y: number): Vec2 => ({ x, y });
	if (type === 'flat' || type === 'mono') return [];
	if (type === 'gable') {
		return [
			[lo, p(hi.x, lo.y), p(hi.x, qMid), p(lo.x, qMid)],
			[p(lo.x, qMid), p(hi.x, qMid), hi, p(lo.x, hi.y)]
		];
	}
	const a = xMax - xMin;
	const b = qMax - qMin;
	if (a >= b) {
		const n1 = p(xMin + b / 2, qMid);
		const n2 = p(xMax - b / 2, qMid);
		return [
			[lo, p(hi.x, lo.y), n2, n1],
			[p(hi.x, lo.y), hi, n2],
			[hi, p(lo.x, hi.y), n1, n2],
			[p(lo.x, hi.y), lo, n1]
		].map((r) => dedupe(r, 1e-9, true));
	}
	const xMid = (xMin + xMax) / 2;
	const n1 = p(xMid, qMin + a / 2);
	const n2 = p(xMid, qMax - a / 2);
	return [
		[lo, p(hi.x, lo.y), n1],
		[p(hi.x, lo.y), hi, n2, n1],
		[hi, p(lo.x, hi.y), n2],
		[p(lo.x, hi.y), lo, n1, n2]
	].map((r) => dedupe(r, 1e-9, true));
}

function creasesOf(f: Frame, type: RoofEntity['type']): Crease[] {
	const { xMin, xMax, qMin, qMax } = f.box;
	if (type === 'flat' || type === 'mono') return [];
	if (type === 'gable') return [{ a: 0, b: 1, c: (qMin + qMax) / 2 }];
	return [
		{ a: 0, b: 1, c: (qMin + qMax) / 2 },
		{ a: 1, b: 0, c: (xMin + xMax) / 2 },
		{ a: -1, b: 1, c: qMin - xMin },
		{ a: 1, b: 1, c: xMax + qMin },
		{ a: 1, b: 1, c: qMax + xMin },
		{ a: -1, b: 1, c: qMax - xMax }
	];
}

/** Extra ring vertices where an edge crosses a crease, so the eave wall follows the roof exactly. */
function splitAtCreases(ring: readonly Vec2[], creases: readonly Crease[]): Vec2[] {
	if (creases.length === 0) return [...ring];
	const out: Vec2[] = [];
	for (let i = 0; i < ring.length; i++) {
		const p = ring[i];
		const q = ring[(i + 1) % ring.length];
		out.push(p);
		const dx = q.x - p.x;
		const dy = q.y - p.y;
		const ts: number[] = [];
		for (const c of creases) {
			const den = c.a * dx + c.b * dy;
			if (Math.abs(den) < 1e-12) continue;
			const t = (c.c - c.a * p.x - c.b * p.y) / den;
			if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
		}
		ts.sort((m, n) => m - n);
		for (const t of ts) out.push({ x: p.x + dx * t, y: p.y + dy * t });
	}
	return dedupe(out, 1e-9, true);
}

type Mesh = { pts: Vec2[]; tris: number[] };

function triangulate(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[]): Mesh {
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
	const tris: number[] = [];
	for (let i = 0; i < raw.length; i += 3) {
		const a = raw[i];
		const b = raw[i + 1];
		const c = raw[i + 2];
		const twice =
			(pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) -
			(pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
		if (twice > 0) tris.push(a, b, c);
		else tris.push(a, c, b);
	}
	return { pts, tris };
}

function surface(
	mesh: Mesh,
	height: (p: Vec2) => number,
	back: (p: Vec2) => Vec2,
	up: boolean
): Solid {
	const s = emptySolid();
	for (const p of mesh.pts) {
		const w = back(p);
		pushVertex(s, w.x, height(p), -w.y);
	}
	for (let i = 0; i < mesh.tris.length; i += 3) {
		const a = mesh.tris[i];
		const b = mesh.tris[i + 1];
		const c = mesh.tris[i + 2];
		if (up) s.indices.push(a, b, c);
		else s.indices.push(a, c, b);
	}
	return s;
}

/** An upright quad on a plan edge, outward for a counter-clockwise ring. */
function strip(
	p0: Vec2,
	p1: Vec2,
	y0a: number,
	y0b: number,
	y1a: number,
	y1b: number
): Solid {
	const s = emptySolid();
	if (y1a - y0a < 1e-6 && y1b - y0b < 1e-6) return s;
	const i0 = pushVertex(s, p0.x, y0a, -p0.y);
	const i1 = pushVertex(s, p1.x, y0b, -p1.y);
	const i2 = pushVertex(s, p1.x, y1b, -p1.y);
	const i3 = pushVertex(s, p0.x, y1a, -p0.y);
	pushQuad(s, i0, i1, i2, i3);
	return s;
}

function boxOf(pts: readonly Vec2[]): Box {
	let xMin = Infinity;
	let xMax = -Infinity;
	let qMin = Infinity;
	let qMax = -Infinity;
	for (const p of pts) {
		if (p.x < xMin) xMin = p.x;
		if (p.x > xMax) xMax = p.x;
		if (p.y < qMin) qMin = p.y;
		if (p.y > qMax) qMax = p.y;
	}
	return { xMin, xMax, qMin, qMax };
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
