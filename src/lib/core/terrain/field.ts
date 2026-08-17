import { docBounds } from '../doc/doc.js';
import type { Doc, Grade } from '../doc/types.js';
import { dedupe, distToRing, pointInRing } from '../geom/polygon.js';
import { rectEmpty, type Vec2 } from '../geom/vec2.js';

/** Ground heights on a regular grid, row major from the south west corner. */
export type HeightField = {
	x0: number;
	y0: number;
	cell: number;
	nx: number;
	ny: number;
	h: Float32Array;
};

const FINEST_CELL = 0.25;
const MAX_CELLS = 250_000;
const MARGIN = 10;

type Spot = { at: Vec2; z: number };
type Pad = { ring: Vec2[]; grade: Grade };

/**
 * Bake the document's height points and levelled areas into a grid every renderer
 * shares. Null means the document says nothing about height, and every caller then
 * treats the ground as flat at 0 rather than paying for a field of zeroes.
 */
export function buildField(doc: Doc): HeightField | null {
	const spots: Spot[] = [];
	const pads: Pad[] = [];
	for (const e of doc.entities) {
		if (e.k === 'spot') spots.push({ at: e.at, z: e.z });
		else if (e.k === 'area' && e.grade) {
			const ring = dedupe(e.ring, 1e-7, true);
			if (ring.length >= 3) pads.push({ ring, grade: e.grade });
		}
	}
	if (spots.length === 0 && pads.length === 0) return null;

	const b = docBounds(doc);
	if (rectEmpty(b)) return null;
	const w = b.max.x - b.min.x + 2 * MARGIN;
	const h = b.max.y - b.min.y + 2 * MARGIN;
	let cell = FINEST_CELL;
	while (Math.ceil(w / cell) * Math.ceil(h / cell) > MAX_CELLS) cell *= 2;

	const nx = Math.ceil(w / cell) + 1;
	const ny = Math.ceil(h / cell) + 1;
	const field: HeightField = {
		x0: b.min.x - MARGIN,
		y0: b.min.y - MARGIN,
		cell,
		nx,
		ny,
		h: new Float32Array(nx * ny)
	};

	fillBase(field, spots);
	for (const pad of pads) stampPad(field, pad);
	return field;
}

/** Bilinear read, clamped at the edge. A null field is flat ground at 0. */
export function heightAt(f: HeightField | null, x: number, y: number): number {
	if (!f) return 0;
	const gx = clamp((x - f.x0) / f.cell, 0, f.nx - 1);
	const gy = clamp((y - f.y0) / f.cell, 0, f.ny - 1);
	const i = Math.min(Math.floor(gx), f.nx - 2 < 0 ? 0 : f.nx - 2);
	const j = Math.min(Math.floor(gy), f.ny - 2 < 0 ? 0 : f.ny - 2);
	const tx = gx - i;
	const ty = gy - j;
	const i1 = Math.min(i + 1, f.nx - 1);
	const j1 = Math.min(j + 1, f.ny - 1);
	const h00 = f.h[j * f.nx + i];
	const h10 = f.h[j * f.nx + i1];
	const h01 = f.h[j1 * f.nx + i];
	const h11 = f.h[j1 * f.nx + i1];
	return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * The ground between the height points, by moving least squares: at each cell a plane is
 * fitted through all the points, weighted by one over distance to the fourth, which makes
 * it pass exactly through every point and reproduce a plane exactly from three of them.
 * Weighting alone does not make an edit local on a plot with a handful of points, so the
 * side view pins the ground either side of a drag; see `edit.ts`.
 */
function fillBase(f: HeightField, spots: readonly Spot[]): void {
	if (spots.length === 0) return;
	if (spots.length === 1) {
		f.h.fill(spots[0].z);
		return;
	}
	for (let j = 0; j < f.ny; j++) {
		const y = f.y0 + j * f.cell;
		for (let i = 0; i < f.nx; i++) {
			const x = f.x0 + i * f.cell;
			f.h[j * f.nx + i] = localPlane(spots, x, y);
		}
	}
}

/**
 * Slopes are only trusted in a direction the points actually spread out along. Below a
 * twentieth of the data's own length the crossfall is ignored, at a quarter and beyond it
 * counts in full: points strung out along one line say nothing about the fall across it,
 * and reading one off a two centimetre baseline used to throw the plot edges hundreds of
 * metres up and down.
 */
const SPREAD_IGNORED = 0.05;
const SPREAD_TRUSTED = 0.25;

/** Height at one spot, or a plane fitted around it with the near points weighted hardest. */
function localPlane(spots: readonly Spot[], x: number, y: number): number {
	let sw = 0;
	let sx = 0;
	let sy = 0;
	let sz = 0;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	let sxz = 0;
	let syz = 0;
	for (const s of spots) {
		const dx = s.at.x - x;
		const dy = s.at.y - y;
		const d2 = dx * dx + dy * dy;
		if (d2 < 1e-9) return s.z;
		const w = 1 / (d2 * d2);
		sw += w;
		sx += w * dx;
		sy += w * dy;
		sz += w * s.z;
		sxx += w * dx * dx;
		sxy += w * dx * dy;
		syy += w * dy * dy;
		sxz += w * dx * s.z;
		syz += w * dy * s.z;
	}
	if (sw <= 0) return 0;

	const cx = sx / sw;
	const cy = sy / sw;
	const zbar = sz / sw;
	// Weighted moments about the points' own centre, which is where the slopes are read from.
	const mxx = sxx - sx * cx;
	const mxy = sxy - sx * cy;
	const myy = syy - sy * cy;
	const bx = sxz - sx * zbar;
	const by = syz - sy * zbar;

	const half = (mxx + myy) / 2;
	const gap = Math.hypot((mxx - myy) / 2, mxy);
	const l1 = half + gap;
	const l2 = Math.max(0, half - gap);
	if (!(l1 > 0)) return zbar;
	const [ux, uy] =
		Math.abs(mxy) > 1e-12 * (mxx + myy) ? unit(l1 - myy, mxy) : mxx >= myy ? [1, 0] : [0, 1];

	let z = zbar;
	for (const [l, dx, dy] of [
		[l1, ux, uy],
		[l2, -uy, ux]
	] as const) {
		if (!(l > 0)) continue;
		const trust = spreadTrust(Math.sqrt(l / l1));
		if (trust <= 0) continue;
		const slope = (bx * dx + by * dy) / l;
		z -= trust * slope * (cx * dx + cy * dy);
	}
	return z;
}

function unit(x: number, y: number): [number, number] {
	const len = Math.hypot(x, y);
	return len > 1e-12 ? [x / len, y / len] : [1, 0];
}

function spreadTrust(ratio: number): number {
	const t = (ratio - SPREAD_IGNORED) / (SPREAD_TRUSTED - SPREAD_IGNORED);
	const c = t < 0 ? 0 : t > 1 ? 1 : t;
	return c * c * (3 - 2 * c);
}

/** Flatten the ring to its level, and ramp the ground back to meet it if it wants a bank. */
function stampPad(f: HeightField, pad: Pad): void {
	const run = pad.grade.edge === 'bank' ? Math.max(0, pad.grade.run) : 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of pad.ring) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const i0 = Math.max(0, Math.floor((minX - run - f.x0) / f.cell));
	const i1 = Math.min(f.nx - 1, Math.ceil((maxX + run - f.x0) / f.cell));
	const j0 = Math.max(0, Math.floor((minY - run - f.y0) / f.cell));
	const j1 = Math.min(f.ny - 1, Math.ceil((maxY + run - f.y0) / f.cell));

	for (let j = j0; j <= j1; j++) {
		const y = f.y0 + j * f.cell;
		for (let i = i0; i <= i1; i++) {
			const x = f.x0 + i * f.cell;
			const at = { x, y };
			const k = j * f.nx + i;
			if (pointInRing(at, pad.ring)) {
				f.h[k] = pad.grade.level;
				continue;
			}
			if (run <= 0) continue;
			const d = distToRing(at, pad.ring);
			if (d >= run) continue;
			f.h[k] = lerp(pad.grade.level, f.h[k], smoothstep(d / run));
		}
	}
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
