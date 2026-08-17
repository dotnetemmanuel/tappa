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
 * The weighting is what keeps an edit local: a point holds the ground where it stands, so
 * raising one part of the slope leaves the rest of it where the other points pin it.
 */
function fillBase(f: HeightField, spots: readonly Spot[]): void {
	if (spots.length === 0) return;
	if (spots.length === 1) {
		f.h.fill(spots[0].z);
		return;
	}
	const line = collinearFit(spots);
	for (let j = 0; j < f.ny; j++) {
		const y = f.y0 + j * f.cell;
		for (let i = 0; i < f.nx; i++) {
			const x = f.x0 + i * f.cell;
			f.h[j * f.nx + i] = line ? line(x, y) : localPlane(spots, x, y);
		}
	}
}

type Plane = (x: number, y: number) => number;

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
	// Normal equations for z = a + b*dx + c*dy about the query point, so `a` is the answer.
	const m = [
		[sw, sx, sy],
		[sx, sxx, sxy],
		[sy, sxy, syy]
	];
	const rhs = [sz, sxz, syz];
	const a = solve3(m, rhs);
	return a === null ? sz / sw : a;
}

/** First unknown of a 3 by 3 system, or null when it is too near singular to trust. */
function solve3(m: number[][], rhs: number[]): number | null {
	const det =
		m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
		m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
		m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
	const scale = Math.abs(m[0][0]) * Math.abs(m[1][1]) * Math.abs(m[2][2]);
	if (!Number.isFinite(det) || Math.abs(det) < 1e-12 * Math.max(scale, 1e-12)) return null;
	const d0 =
		rhs[0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
		m[0][1] * (rhs[1] * m[2][2] - m[1][2] * rhs[2]) +
		m[0][2] * (rhs[1] * m[2][1] - m[1][1] * rhs[2]);
	return d0 / det;
}

/**
 * Points in a line leave the across-slope direction undetermined, and a plane fit would pick
 * one at random, so the ground tilts only along the line they make.
 */
function collinearFit(spots: readonly Spot[]): Plane | null {
	let sx = 0;
	let sy = 0;
	let sz = 0;
	for (const s of spots) {
		sx += s.at.x;
		sy += s.at.y;
		sz += s.z;
	}
	const n = spots.length;
	const mx = sx / n;
	const my = sy / n;
	const mz = sz / n;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	let sxz = 0;
	let syz = 0;
	for (const s of spots) {
		const dx = s.at.x - mx;
		const dy = s.at.y - my;
		const dz = s.z - mz;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
		sxz += dx * dz;
		syz += dy * dz;
	}
	const det = sxx * syy - sxy * sxy;
	if (Math.abs(det) > 1e-9) return null;
	const l2 = sxx + syy;
	if (l2 < 1e-12) return () => mz;
	const [ux, uy] = sxx >= syy ? [sxx, sxy] : [sxy, syy];
	const ul = Math.hypot(ux, uy);
	if (ul < 1e-12) return () => mz;
	const dx = ux / ul;
	const dy = uy / ul;
	const g = (sxz * dx + syz * dy) / (sxx * dx * dx + 2 * sxy * dx * dy + syy * dy * dy);
	return (x, y) => mz + g * ((x - mx) * dx + (y - my) * dy);
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
