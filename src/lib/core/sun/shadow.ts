import { buildRoof, type RoofResult } from '../building/roof.js';
import { entityRing, docBounds } from '../doc/doc.js';
import type { Doc, PlantEntity, RoofEntity, SpeciesId } from '../doc/types.js';
import { dedupe } from '../geom/polygon.js';
import { rectEmpty, rectFromPoints, rectOverlaps, type Rect, type Vec2 } from '../geom/vec2.js';
import { SPECIES, speciesOr } from '../plants/catalog.js';
import { sizeAt } from '../plants/growth.js';
import { heightAt, type HeightField } from '../terrain/field.js';
import { groundUnder } from '../terrain/query.js';
import { daySamples, sunAt, sunTimes } from './position.js';

/** Anything that can block the sun, kept deliberately crude. */
export type Occluder =
	| { o: 'prism'; ring: Vec2[]; base: number; top: number }
	| { o: 'ellipsoid'; centre: Vec2; base: number; top: number; rx: number; rz: number };

/** All the study needs of a species. `plants/growth.ts` is not there yet, so the curve is local. */
type Canopy = { mature: { h: number; w: number }; growthRate: number; evergreen: boolean };

const CANOPIES = new Map<SpeciesId, Canopy>(SPECIES.map((s) => [s.id, s]));

const UNKNOWN_CANOPY: Canopy = { mature: { h: 4, w: 3 }, growthRate: 12, evergreen: false };

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

function plantOccluder(
	e: PlantEntity,
	ageYears: number,
	month: number,
	field: HeightField | null
): Occluder | null {
	const known = CANOPIES.get(e.species);
	// One growth curve for the whole app, or the sun study and the 3D view disagree.
	const size = known ? sizeAt(speciesOr(e.species), ageYears, e.sizeJitter) : fallbackSize(ageYears, e);
	const sp = known ?? UNKNOWN_CANOPY;
	const height = size.h;
	const width = size.w;
	if (height < 0.3) return null;
	// A plant tall enough to walk under carries its crown on a stem; a shrub sits on the ground.
	const g = heightAt(field, e.at.x, e.at.y);
	const base = g + (height >= 3 ? height * 0.3 : 0);
	const leafless = !sp.evergreen && (month <= 3 || month >= 11);
	const r = (width / 2) * (leafless ? 0.45 : 1);
	if (r < 0.15) return null;
	return { o: 'ellipsoid', centre: e.at, base, top: g + height, rx: r, rz: r };
}

function fallbackSize(ageYears: number, e: PlantEntity): { h: number; w: number } {
	const f = 1 - Math.exp((-Math.log(3) * Math.max(0, ageYears)) / UNKNOWN_CANOPY.growthRate);
	const scale = clamp(1 + (Number.isFinite(e.sizeJitter) ? e.sizeJitter : 0), 0.5, 1.5);
	return { h: UNKNOWN_CANOPY.mature.h * f * scale, w: UNKNOWN_CANOPY.mature.w * f * scale };
}

function tryBuildRoof(doc: Doc, roof: RoofEntity): RoofResult | null {
	try {
		return buildRoof(doc, roof);
	} catch {
		return null;
	}
}

function buildOccluders(
	doc: Doc,
	ageOf: (p: PlantEntity) => number,
	month: number,
	field: HeightField | null
): Occluder[] {
	const out: Occluder[] = [];
	for (const e of doc.entities) {
		if (e.k === 'wall' || e.k === 'line') {
			const ring = entityRing(doc, e);
			if (ring && ring.length >= 3 && e.height > 0.05) {
				const g = groundUnder(field, ring);
				// A wall runs from the ground to its own floor plus height; a fence rides the slope.
				const top = e.k === 'wall' ? (e.floor ?? 0) + e.height : g.max + e.height;
				out.push({ o: 'prism', ring, base: g.min, top });
			}
		} else if (e.k === 'plant') {
			const o = plantOccluder(e, ageOf(e), month, field);
			if (o) out.push(o);
		} else if (e.k === 'roof') {
			// A roof that will not build costs its own shadow, not the whole study.
			const r = tryBuildRoof(doc, e);
			if (!r || r.outline.length < 3) continue;
			// One box stands in for a pitched roof, so take a height between eave and ridge.
			const top = r.eaveHeight + Math.max(0.15, (r.ridgeHeight - r.eaveHeight) * 0.55);
			out.push({ o: 'prism', ring: r.outline, base: r.eaveHeight, top });
		}
	}
	return out;
}

/** Build occluders from the document at a given plant age. */
export function occludersOf(
	doc: Doc,
	opts: { years: number; month: number; field?: HeightField | null }
): Occluder[] {
	return buildOccluders(doc, () => Math.max(0, opts.years), clamp(opts.month, 1, 12), opts.field ?? null);
}

function occludersForDay(
	doc: Doc,
	day: Date,
	field: HeightField | null,
	years?: number
): Occluder[] {
	const age =
		years === undefined
			? (p: PlantEntity) => Math.max(0, day.getFullYear() - p.plantedYear)
			: (p: PlantEntity) => Math.max(0, years - p.plantedYear);
	return buildOccluders(doc, age, day.getMonth() + 1, field);
}

export type ShadowGrid = {
	/** Grid origin in plan metres, at the lower left cell corner. */
	origin: Vec2;
	cell: number;
	cols: number;
	rows: number;
	/** Sunlit hours per cell, row major from the origin going north. */
	hours: Float32Array;
	/** The longest any cell was lit, for scaling the heatmap. */
	maxHours: number;
	/** Hours the sun was above the horizon that day, the theoretical maximum. */
	dayLength: number;
};

export type ShadowOptions = {
	day: Date;
	stepMinutes: number;
	cell: number;
	/** Area to cover; defaults to the plot boundary, or the document bounds. */
	bounds?: Rect;
	/** Age of the planting, from the year slider. Falls back to the plant's own planted year. */
	years?: number;
	/** Called with 0 to 1 so a long study can show progress and stay responsive. */
	onProgress?: (t: number) => void;
	/** The baked ground. Absent means flat, and the study then costs exactly what it did before. */
	field?: HeightField | null;
};

type PrismPrep = {
	o: 'prism';
	xs: Float64Array;
	ys: Float64Array;
	base: number;
	top: number;
	cx: number;
	cy: number;
	r: number;
	box: Rect;
};

type EllipsoidPrep = {
	o: 'ellipsoid';
	cx: number;
	cy: number;
	cz: number;
	rx: number;
	ry: number;
	rz: number;
	base: number;
	top: number;
	r: number;
	box: Rect;
};

type Prep = PrismPrep | EllipsoidPrep;

function prepare(occluders: readonly Occluder[]): Prep[] {
	const out: Prep[] = [];
	for (const o of occluders) {
		if (o.o === 'prism') {
			const ring = dedupe(o.ring, 1e-7, true);
			if (ring.length < 3 || !(o.top > o.base)) continue;
			const xs = new Float64Array(ring.length);
			const ys = new Float64Array(ring.length);
			for (let i = 0; i < ring.length; i++) {
				xs[i] = ring[i].x;
				ys[i] = ring[i].y;
			}
			const box = rectFromPoints(ring);
			const cx = (box.min.x + box.max.x) / 2;
			const cy = (box.min.y + box.max.y) / 2;
			out.push({
				o: 'prism',
				xs,
				ys,
				base: o.base,
				top: o.top,
				cx,
				cy,
				r: Math.hypot(box.max.x - cx, box.max.y - cy),
				box
			});
		} else {
			if (!(o.top > o.base) || !(o.rx > 0) || !(o.rz > 0)) continue;
			const r = Math.max(o.rx, o.rz);
			out.push({
				o: 'ellipsoid',
				cx: o.centre.x,
				cy: o.centre.y,
				cz: (o.base + o.top) / 2,
				rx: o.rx,
				ry: (o.top - o.base) / 2,
				rz: o.rz,
				base: o.base,
				top: o.top,
				r,
				box: {
					min: { x: o.centre.x - o.rx, y: o.centre.y - o.rz },
					max: { x: o.centre.x + o.rx, y: o.centre.y + o.rz }
				}
			});
		}
	}
	// Tallest first, because the tall things win most of the early exits.
	return out.sort((a, b) => b.top - a.top);
}

/**
 * Does the prism cover the ray from (px, py) towards the sun? The ray is tested against the
 * ring in plan, then the entry and exit heights are compared with the prism's own slab. Taking
 * the outermost crossings makes a concave ring shade a little more than it should, never less.
 */
function prismBlocks(
	q: PrismPrep,
	px: number,
	py: number,
	pz: number,
	hx: number,
	hy: number,
	tanAlt: number
): boolean {
	const n = q.xs.length;
	let enter = Infinity;
	let exit = -Infinity;
	let crossings = 0;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const ax = q.xs[j];
		const ay = q.ys[j];
		const ex = q.xs[i] - ax;
		const ey = q.ys[i] - ay;
		const den = hx * ey - hy * ex;
		if (den === 0) continue;
		const rx = ax - px;
		const ry = ay - py;
		const u = (rx * hy - ry * hx) / den;
		if (u < 0 || u >= 1) continue;
		const s = (rx * ey - ry * ex) / den;
		if (s <= 1e-9) continue;
		crossings++;
		if (s < enter) enter = s;
		if (s > exit) exit = s;
	}
	if (crossings === 0) return false;
	const inside = (crossings & 1) === 1;
	const zEnter = pz + (inside ? 0 : enter * tanAlt);
	const zExit = pz + exit * tanAlt;
	return zExit >= q.base && zEnter <= q.top;
}

function ellipsoidBlocks(
	q: EllipsoidPrep,
	px: number,
	py: number,
	pz: number,
	hx: number,
	hy: number,
	cosAlt: number,
	sinAlt: number
): boolean {
	const ox = (px - q.cx) / q.rx;
	const oy = (py - q.cy) / q.rz;
	const oz = (pz - q.cz) / q.ry;
	const c = ox * ox + oy * oy + oz * oz - 1;
	if (c <= 0) return true;
	const dx = (hx * cosAlt) / q.rx;
	const dy = (hy * cosAlt) / q.rz;
	const dz = sinAlt / q.ry;
	const a = dx * dx + dy * dy + dz * dz;
	const b = 2 * (ox * dx + oy * dy + oz * dz);
	const disc = b * b - 4 * a * c;
	if (disc <= 0) return false;
	return (-b - Math.sqrt(disc)) / (2 * a) > 1e-6;
}

/** How far and how coarsely the land is asked whether it shades itself. Cheap on purpose. */
const LAND_REACH = 60;
const LAND_STEP = 1;

function landBlocks(
	f: HeightField,
	px: number,
	py: number,
	pz: number,
	hx: number,
	hy: number,
	tanAlt: number
): boolean {
	for (let d = LAND_STEP; d <= LAND_REACH; d += LAND_STEP) {
		if (heightAt(f, px + hx * d, py + hy * d) > pz + d * tanAlt) return true;
	}
	return false;
}

type Sweep = { hours: Float32Array; dayLength: number; maxHours: number };

/** Walk the day once per sample time, marking which of the given points can see the sun. */
function sweep(
	doc: Doc,
	day: Date,
	stepMinutes: number,
	xs: Float64Array,
	ys: Float64Array,
	area: Rect,
	field: HeightField | null,
	onProgress?: (t: number) => void,
	years?: number
): Sweep {
	const t = sunTimes(doc, day);
	const dayLength = t.up ? (t.sunset.getTime() - t.sunrise.getTime()) / 3_600_000 : 0;
	const hours = new Float32Array(xs.length);
	const times = daySamples(doc, day, stepMinutes);
	const last = times.length - 1;
	if (last < 0) {
		onProgress?.(1);
		return { hours, dayLength, maxHours: 0 };
	}
	const preps = prepare(occludersForDay(doc, day, field, years));
	const zs = new Float64Array(xs.length);
	if (field) for (let i = 0; i < xs.length; i++) zs[i] = heightAt(field, xs[i], ys[i]);
	const act: Prep[] = [];
	const reach: number[] = [];
	for (let si = 0; si <= last; si++) {
		const p = sunAt(doc, times[si]);
		onProgress?.(si / Math.max(1, last));
		if (!p.up) continue;
		// The endpoints only stand for half a slice each, so a full day still adds up to dayLength.
		const share = last === 0 ? dayLength : (dayLength / last) * (si === 0 || si === last ? 0.5 : 1);
		if (share <= 0) continue;
		const hx = Math.sin(p.azimuth);
		const hy = Math.cos(p.azimuth);
		const cosAlt = Math.cos(p.altitude);
		const sinAlt = Math.sin(p.altitude);
		const tanAlt = Math.tan(p.altitude);
		act.length = 0;
		reach.length = 0;
		for (const q of preps) {
			// Clamped: an infinite shadow times a zero direction component is NaN, dropping the occluder.
			const throwLen = q.top / Math.max(tanAlt, 1e-4);
			const cast: Rect = {
				min: {
					x: Math.min(q.box.min.x, q.box.min.x - hx * throwLen),
					y: Math.min(q.box.min.y, q.box.min.y - hy * throwLen)
				},
				max: {
					x: Math.max(q.box.max.x, q.box.max.x - hx * throwLen),
					y: Math.max(q.box.max.y, q.box.max.y - hy * throwLen)
				}
			};
			if (!rectOverlaps(cast, area)) continue;
			act.push(q);
			reach.push(throwLen);
		}
		if (act.length === 0 && !field) {
			for (let i = 0; i < hours.length; i++) hours[i] += share;
			continue;
		}
		for (let i = 0; i < xs.length; i++) {
			const px = xs[i];
			const py = ys[i];
			const pz = zs[i];
			let lit = true;
			for (let k = 0; k < act.length; k++) {
				const q = act[k];
				const dx = q.cx - px;
				const dy = q.cy - py;
				const along = dx * hx + dy * hy;
				if (along < -q.r || along > reach[k] + q.r) continue;
				if (Math.abs(-dx * hy + dy * hx) > q.r) continue;
				const hit =
					q.o === 'prism'
						? prismBlocks(q, px, py, pz, hx, hy, tanAlt)
						: ellipsoidBlocks(q, px, py, pz, hx, hy, cosAlt, sinAlt);
				if (hit) {
					lit = false;
					break;
				}
			}
			if (lit && field && landBlocks(field, px, py, pz, hx, hy, tanAlt)) lit = false;
			if (lit) hours[i] += share;
		}
	}
	let maxHours = 0;
	for (let i = 0; i < hours.length; i++) if (hours[i] > maxHours) maxHours = hours[i];
	onProgress?.(1);
	return { hours, dayLength, maxHours };
}

function studyArea(doc: Doc, bounds?: Rect): Rect {
	if (bounds && !rectEmpty(bounds)) return bounds;
	if (doc.plot.boundary.length >= 3) return rectFromPoints(doc.plot.boundary);
	return docBounds(doc);
}

export function shadowStudy(doc: Doc, o: ShadowOptions): ShadowGrid {
	const cell = o.cell > 0 ? o.cell : 0.5;
	const area = studyArea(doc, o.bounds);
	if (rectEmpty(area) || !Number.isFinite(area.min.x) || !Number.isFinite(area.max.y)) {
		o.onProgress?.(1);
		return {
			origin: { x: 0, y: 0 },
			cell,
			cols: 0,
			rows: 0,
			hours: new Float32Array(0),
			maxHours: 0,
			dayLength: 0
		};
	}
	const origin = {
		x: Math.floor(area.min.x / cell) * cell,
		y: Math.floor(area.min.y / cell) * cell
	};
	const cols = Math.max(1, Math.ceil((area.max.x - origin.x) / cell));
	const rows = Math.max(1, Math.ceil((area.max.y - origin.y) / cell));
	const count = cols * rows;
	const xs = new Float64Array(count);
	const ys = new Float64Array(count);
	for (let row = 0; row < rows; row++) {
		const y = origin.y + (row + 0.5) * cell;
		for (let col = 0; col < cols; col++) {
			const i = row * cols + col;
			xs[i] = origin.x + (col + 0.5) * cell;
			ys[i] = y;
		}
	}
	const covered: Rect = {
		min: origin,
		max: { x: origin.x + cols * cell, y: origin.y + rows * cell }
	};
	const s = sweep(doc, o.day, o.stepMinutes, xs, ys, covered, o.field ?? null, o.onProgress, o.years);
	return {
		origin,
		cell,
		cols,
		rows,
		hours: s.hours,
		maxHours: s.maxHours,
		dayLength: s.dayLength
	};
}

/** Sunlit hours at one point, for the per plant sun check. */
export function sunHoursAt(doc: Doc, at: Vec2, o: Omit<ShadowOptions, 'cell' | 'bounds'>): number {
	const xs = new Float64Array([at.x]);
	const ys = new Float64Array([at.y]);
	const area: Rect = { min: { x: at.x, y: at.y }, max: { x: at.x, y: at.y } };
	return sweep(doc, o.day, o.stepMinutes, xs, ys, area, o.field ?? null, o.onProgress, o.years).hours[0];
}

/** Sample the grid at a plan point; returns null outside it. */
export function hoursAt(g: ShadowGrid, at: Vec2): number | null {
	if (g.cols === 0 || g.rows === 0) return null;
	const col = Math.floor((at.x - g.origin.x) / g.cell);
	const row = Math.floor((at.y - g.origin.y) / g.cell);
	if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return null;
	return g.hours[row * g.cols + col];
}

const HEAT_STOPS: readonly (readonly [number, number, number])[] = [
	[38, 56, 82],
	[54, 92, 110],
	[104, 134, 108],
	[190, 176, 108],
	[242, 226, 166]
];

const hex2 = (x: number): string =>
	Math.round(Math.min(255, Math.max(0, x)))
		.toString(16)
		.padStart(2, '0');

/** Heatmap colour for a cell, cold blue in deep shade to warm straw in full sun. */
export function shadowColour(hours: number, maxHours: number): string {
	const h = Number.isFinite(hours) ? hours : 0;
	const t = maxHours > 0 ? clamp(h / maxHours, 0, 1) : 0;
	const span = t * (HEAT_STOPS.length - 1);
	const i = Math.min(HEAT_STOPS.length - 2, Math.floor(span));
	const f = span - i;
	const a = HEAT_STOPS[i];
	const b = HEAT_STOPS[i + 1];
	return `#${hex2(a[0] + (b[0] - a[0]) * f)}${hex2(a[1] + (b[1] - a[1]) * f)}${hex2(a[2] + (b[2] - a[2]) * f)}`;
}
