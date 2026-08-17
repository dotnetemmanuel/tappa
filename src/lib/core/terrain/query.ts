import earcut from 'earcut';
import { pointInRing } from '../geom/polygon.js';
import type { Vec2 } from '../geom/vec2.js';
import { heightAt, type HeightField } from './field.js';

export type GroundRange = { min: number; max: number };

/** The lowest and highest ground a footprint covers, interior included. */
export function groundUnder(f: HeightField | null, ring: readonly Vec2[]): GroundRange {
	if (!f || ring.length === 0) return { min: 0, max: 0 };
	let min = Infinity;
	let max = -Infinity;
	const take = (x: number, y: number): void => {
		const z = heightAt(f, x, y);
		if (z < min) min = z;
		if (z > max) max = z;
	};

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		take(a.x, a.y);
		if (a.x < minX) minX = a.x;
		if (a.y < minY) minY = a.y;
		if (a.x > maxX) maxX = a.x;
		if (a.y > maxY) maxY = a.y;
		const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / f.cell);
		for (let s = 1; s < steps; s++) {
			take(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
		}
	}

	const i0 = Math.ceil((minX - f.x0) / f.cell);
	const i1 = Math.floor((maxX - f.x0) / f.cell);
	const j0 = Math.ceil((minY - f.y0) / f.cell);
	const j1 = Math.floor((maxY - f.y0) / f.cell);
	for (let j = j0; j <= j1; j++) {
		const y = f.y0 + j * f.cell;
		for (let i = i0; i <= i1; i++) {
			const x = f.x0 + i * f.cell;
			if (pointInRing({ x, y }, ring)) take(x, y);
		}
	}
	return { min, max };
}

export type ProfileSample = { at: Vec2; z: number };

/** Ground heights along a run, every vertex kept and no gap longer than `step`. */
export function profileAlong(
	f: HeightField | null,
	spine: readonly Vec2[],
	step: number
): ProfileSample[] {
	const out: ProfileSample[] = [];
	if (spine.length === 0) return out;
	const push = (at: Vec2): void => {
		out.push({ at, z: heightAt(f, at.x, at.y) });
	};
	push(spine[0]);
	const gap = Math.max(step, 1e-3);
	for (let i = 1; i < spine.length; i++) {
		const a = spine[i - 1];
		const b = spine[i];
		const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / gap);
		for (let s = 1; s < n; s++) {
			push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
		}
		push(b);
	}
	return out;
}

export type DrapedMesh = { positions: Float32Array; uvs: Float32Array; index: Uint32Array };

const EMPTY: DrapedMesh = {
	positions: new Float32Array(0),
	uvs: new Float32Array(0),
	index: new Uint32Array(0)
};

/**
 * A surface laid over the ground: triangulated flat, cut down until no edge is longer
 * than `maxEdge`, then every vertex lifted to the ground plus `lift`. Positions come
 * out in scene axes, uvs in plan metres. Split edges share their midpoint, so the only
 * seams left are the sub-millimetre ones where a neighbour did not need splitting.
 */
export function drape(
	f: HeightField | null,
	ring: readonly Vec2[],
	holes: readonly (readonly Vec2[])[],
	lift: number,
	maxEdge: number
): DrapedMesh {
	if (ring.length < 3) return EMPTY;
	const flat: number[] = [];
	const holeStarts: number[] = [];
	for (const p of ring) flat.push(p.x, p.y);
	for (const h of holes) {
		if (h.length < 3) continue;
		holeStarts.push(flat.length / 2);
		for (const p of h) flat.push(p.x, p.y);
	}
	const idx = earcut(flat, holeStarts.length > 0 ? holeStarts : undefined, 2);
	if (idx.length === 0) return EMPTY;

	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = 0; i < flat.length; i += 2) {
		xs.push(flat[i]);
		ys.push(flat[i + 1]);
	}

	const mid = new Map<string, number>();
	const midpoint = (a: number, b: number): number => {
		const key = a < b ? `${a}:${b}` : `${b}:${a}`;
		const hit = mid.get(key);
		if (hit !== undefined) return hit;
		xs.push((xs[a] + xs[b]) / 2);
		ys.push((ys[a] + ys[b]) / 2);
		const i = xs.length - 1;
		mid.set(key, i);
		return i;
	};

	const limit = f && maxEdge > 0 ? maxEdge : Infinity;
	const tris: number[] = [];
	const queue: number[] = [...idx];
	while (queue.length >= 3) {
		const c = queue.pop() as number;
		const b = queue.pop() as number;
		const a = queue.pop() as number;
		const e = [
			[len2(xs, ys, a, b), a, b, c],
			[len2(xs, ys, b, c), b, c, a],
			[len2(xs, ys, c, a), c, a, b]
		].sort((p, q) => q[0] - p[0])[0];
		if (e[0] <= limit * limit) {
			tris.push(a, b, c);
			continue;
		}
		const m = midpoint(e[1], e[2]);
		queue.push(e[1], m, e[3], m, e[2], e[3]);
	}

	const count = xs.length;
	const positions = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	for (let i = 0; i < count; i++) {
		positions[i * 3] = xs[i];
		positions[i * 3 + 1] = heightAt(f, xs[i], ys[i]) + lift;
		positions[i * 3 + 2] = -ys[i];
		uvs[i * 2] = xs[i];
		uvs[i * 2 + 1] = ys[i];
	}
	// earcut winds clockwise in plan, which is counter-clockwise once y is flipped into z.
	const index = new Uint32Array(tris.length);
	for (let i = 0; i < tris.length; i += 3) {
		index[i] = tris[i];
		index[i + 1] = tris[i + 2];
		index[i + 2] = tris[i + 1];
	}
	return { positions, uvs, index };
}

function len2(xs: readonly number[], ys: readonly number[], a: number, b: number): number {
	const dx = xs[a] - xs[b];
	const dy = ys[a] - ys[b];
	return dx * dx + dy * dy;
}
