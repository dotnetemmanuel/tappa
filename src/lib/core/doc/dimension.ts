import {
	add,
	angle as angleOf,
	cross,
	dist,
	distToSegment,
	fromAngle,
	len,
	mul,
	norm,
	perp,
	sub,
	type Vec2
} from '../geom/vec2.js';
import {
	area as ringArea,
	closestOnPolyline,
	closestOnRing,
	pathLength,
	perimeter
} from '../geom/polygon.js';
import { entityVertices, isClosed, isEditable, resolveAnchorPair, wallsAtNode } from './doc.js';
import type { Anchor, DimEntity, Doc, EntityId } from './types.js';

/** How far a witness line runs past the dimension line, in metres at scale 1. */
const WITNESS_OVERSHOOT = 0.15;
/** Gap between the measured point and the start of its witness line. */
const WITNESS_GAP = 0.08;
/** How far the text floats above its own baseline. */
const TEXT_LIFT = 0.12;
const DEFAULT_TEXT_WIDTH = 0.8;

/** Everything a renderer needs to draw one dimension, all in world metres. */
export type DimGeometry = {
	/** The two measured points. */
	a: Vec2;
	b: Vec2;
	/** The offset dimension line the arrows sit on. */
	lineA: Vec2;
	lineB: Vec2;
	/** Thin lines from the measured points out to the dimension line. */
	witnessA: [Vec2, Vec2];
	witnessB: [Vec2, Vec2];
	/** Where the text sits and which way it reads, radians, always upright. */
	textAt: Vec2;
	textRot: number;
	/** Measured distance in metres. */
	value: number;
	/** True when the dimension line is shorter than the text, so the renderer places text outside. */
	cramped: boolean;
};

/** Returns null when either anchor no longer resolves, e.g. its entity was deleted. */
export function dimGeometry(
	doc: Doc,
	dim: DimEntity,
	opts?: { textWidth?: number }
): DimGeometry | null {
	const pair = resolveAnchorPair(doc, dim.from, dim.to);
	if (!pair) return null;
	const [pa, pb] = pair;
	const a = { x: pa.x, y: pa.y };
	const b = { x: pb.x, y: pb.y };

	const span = sub(b, a);
	const value = len(span);
	const dir = value > 0 ? mul(span, 1 / value) : { x: 1, y: 0 };
	const n = perp(dir);
	const side = dim.offset < 0 ? -1 : 1;

	const toLine = mul(n, dim.offset);
	const lineA = add(a, toLine);
	const lineB = add(b, toLine);

	const witness = (p: Vec2): [Vec2, Vec2] => [
		add(p, mul(n, side * WITNESS_GAP)),
		add(p, mul(n, dim.offset + side * WITNESS_OVERSHOOT))
	];

	const textRot = uprightAngle(angleOf(dir));
	const mid = { x: (lineA.x + lineB.x) / 2, y: (lineA.y + lineB.y) / 2 };
	const textAt = add(mid, fromAngle(textRot + Math.PI / 2, TEXT_LIFT));

	return {
		a,
		b,
		lineA,
		lineB,
		witnessA: witness(a),
		witnessB: witness(b),
		textAt,
		textRot,
		value,
		cramped: value < (opts?.textWidth ?? DEFAULT_TEXT_WIDTH)
	};
}

/** Snap the dimension text upright: never upside down, reading left to right. */
export function uprightAngle(rad: number): number {
	const half = Math.PI / 2;
	const eps = 1e-9;
	const tau = Math.PI * 2;
	let a = ((rad % tau) + tau) % tau;
	if (a > Math.PI) a -= tau;
	if (a > half + eps) a -= Math.PI;
	else if (a <= -half + eps) a += Math.PI;
	return a;
}

/** Distance from a point to the dimension, for hit testing the whole drawn form. */
export function dimDistance(g: DimGeometry, p: Vec2): number {
	return Math.min(
		distToSegment(p, g.lineA, g.lineB),
		distToSegment(p, g.witnessA[0], g.witnessA[1]),
		distToSegment(p, g.witnessB[0], g.witnessB[1]),
		dist(p, g.textAt)
	);
}

/** Where an offset drag should land, given a cursor position. Signed, so the dimension can flip sides. */
export function offsetFromPoint(a: Vec2, b: Vec2, cursor: Vec2): number {
	const span = sub(b, a);
	const dir = len(span) > 0 ? norm(span) : { x: 1, y: 0 };
	return cross(dir, sub(cursor, a));
}

/** The nearest anchor the dimension tool would attach to at this point, or a free anchor. */
export function anchorAt(
	doc: Doc,
	at: Vec2,
	tolerance: number,
	exclude?: ReadonlySet<EntityId>
): Anchor {
	const best: { d: number; a: Anchor | null } = { d: Infinity, a: null };
	const take = (d: number, a: Anchor): void => {
		if (d <= tolerance && d < best.d) {
			best.d = d;
			best.a = a;
		}
	};
	const usable = (id: EntityId): boolean => !exclude?.has(id);

	for (const e of doc.entities) {
		// Wall corners are shared nodes, so they belong to the node pass below.
		if (e.k === 'wall' || e.k === 'dim') continue;
		if (!usable(e.id) || !isEditable(doc, e)) continue;
		const vs = entityVertices(doc, e);
		for (let i = 0; i < vs.length; i++) take(dist(at, vs[i]), { k: 'vertex', e: e.id, i });
	}
	if (best.a) return best.a;

	for (const [id, p] of Object.entries(doc.nodes)) {
		if (!wallsAtNode(doc, id).some((w) => usable(w.id) && isEditable(doc, w))) continue;
		take(dist(at, p), { k: 'node', n: id });
	}
	if (best.a) return best.a;

	for (const e of doc.entities) {
		// Anchoring to another dimension would chain anchors, so dimensions are never targets.
		if (e.k === 'dim') continue;
		if (!usable(e.id) || !isEditable(doc, e)) continue;
		const vs = entityVertices(doc, e);
		if (vs.length < 2) continue;
		const hit = isClosed(e) ? closestOnRing(at, vs) : closestOnPolyline(at, vs);
		if (hit) take(hit.d, { k: 'edge', e: e.id, i: hit.seg, t: hit.t });
	}
	if (best.a) return best.a;

	return { k: 'free', at: { x: at.x, y: at.y } };
}

const THIN_SPACE = '\u2009';
const DECIMAL_MARK = ',';

function group(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

/** Locale-free Swedish number: comma decimal, thin-space thousands. */
function decimal(n: number, dp: number, strip: boolean): string {
	const value = Number.isFinite(n) ? n : 0;
	const s = Math.abs(value).toFixed(dp);
	const dot = s.indexOf('.');
	const int = dot < 0 ? s : s.slice(0, dot);
	let frac = dot < 0 ? '' : s.slice(dot + 1);
	if (strip) frac = frac.replace(/0+$/, '');
	const body = group(int) + (frac.length > 0 ? DECIMAL_MARK + frac : '');
	return value < 0 && Number(s) !== 0 ? `-${body}` : body;
}

/** Metres formatted the way a Swedish drawing reads: "4,25 m", "850 mm" under a metre, no trailing zeros past 2 dp. */
export function formatLength(m: number): string {
	const value = Number.isFinite(m) ? m : 0;
	const mm = Math.round(Math.abs(value) * 1000);
	if (mm < 1000) return `${decimal(Math.round(value * 1000), 0, false)} mm`;
	return `${decimal(value, 2, true)} m`;
}

/** "12,4 m²", switching to "1 240 m²" style thousands separation with a thin space. */
export function formatArea(m2: number): string {
	const value = Number.isFinite(m2) ? m2 : 0;
	return `${decimal(value, Math.abs(value) < 100 ? 1 : 0, true)} m²`;
}

/** "45,0°" measured counter-clockwise from east, normalised to 0..360. */
export function formatAngle(rad: number): string {
	const raw = Number.isFinite(rad) ? (rad * 180) / Math.PI : 0;
	const deg = ((raw % 360) + 360) % 360;
	let r = Math.round(deg * 10) / 10;
	if (r >= 360) r -= 360;
	return `${decimal(r, 1, false)}°`;
}

const COMPASS = [
	'N',
	'NNO',
	'NO',
	'ONO',
	'O',
	'OSO',
	'SO',
	'SSO',
	'S',
	'SSV',
	'SV',
	'VSV',
	'V',
	'VNV',
	'NV',
	'NNV'
] as const;

/**
 * Bearing relative to north for the compass readout: "N", "NNO", "SV" and so on, Swedish points.
 * `northOffset` is in degrees, matching `doc.meta.northOffset`.
 */
export function formatBearing(rad: number, northOffset: number): string {
	const a = Number.isFinite(rad) ? rad : 0;
	const off = Number.isFinite(northOffset) ? northOffset : 0;
	const northRad = Math.PI / 2 + (off * Math.PI) / 180;
	const deg = (((((northRad - a) * 180) / Math.PI) % 360) + 360) % 360;
	return COMPASS[Math.round(deg / 22.5) % 16];
}

/** A running readout while drawing: length and angle of the current segment. */
export function formatSegment(from: Vec2, to: Vec2): { length: string; angle: string } {
	const d = sub(to, from);
	return { length: formatLength(len(d)), angle: formatAngle(angleOf(d)) };
}

/** Area and perimeter of a ring in progress. */
export function formatRing(ring: readonly Vec2[]): { area: string; perimeter: string } {
	if (ring.length < 3) {
		return { area: formatArea(0), perimeter: formatLength(pathLength(ring)) };
	}
	return { area: formatArea(ringArea(ring)), perimeter: formatLength(perimeter(ring)) };
}
