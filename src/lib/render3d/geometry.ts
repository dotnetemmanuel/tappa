import earcut from 'earcut';
import { BufferAttribute, BufferGeometry } from 'three';
import type { Solid } from '../core/building/solid.js';
import type { Vec2 } from '../core/geom/vec2.js';

export function solidToGeometry(s: Solid): BufferGeometry {
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(s.positions), 3));
	if (s.uvs && s.uvs.length === (s.positions.length / 3) * 2) {
		g.setAttribute('uv', new BufferAttribute(new Float32Array(s.uvs), 2));
	}
	g.setIndex(s.indices);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/**
 * A flat horizontal surface from a plan ring, triangulated with earcut.
 * uvs are the plan coordinates themselves, so a texture repeat is in metres.
 */
export function ringToGeometry(
	ring: readonly Vec2[],
	holes: readonly (readonly Vec2[])[] = [],
	y = 0
): BufferGeometry | null {
	if (ring.length < 3) return null;
	const flat: number[] = [];
	const holeStarts: number[] = [];
	for (const p of ring) flat.push(p.x, p.y);
	for (const h of holes) {
		if (h.length < 3) continue;
		holeStarts.push(flat.length / 2);
		for (const p of h) flat.push(p.x, p.y);
	}
	const idx = earcut(flat, holeStarts.length > 0 ? holeStarts : undefined, 2);
	if (idx.length === 0) return null;

	const count = flat.length / 2;
	const positions = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	const normals = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const x = flat[i * 2];
		const yPlan = flat[i * 2 + 1];
		positions[i * 3] = x;
		positions[i * 3 + 1] = y;
		positions[i * 3 + 2] = -yPlan;
		uvs[i * 2] = x;
		uvs[i * 2 + 1] = yPlan;
		normals[i * 3 + 1] = 1;
	}
	// earcut winds clockwise in plan, which is counter-clockwise once y is flipped into z.
	const indices = new Uint32Array(idx.length);
	for (let i = 0; i < idx.length; i += 3) {
		indices[i] = idx[i];
		indices[i + 1] = idx[i + 2];
		indices[i + 2] = idx[i + 1];
	}

	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(positions, 3));
	g.setAttribute('uv', new BufferAttribute(uvs, 2));
	g.setAttribute('normal', new BufferAttribute(normals, 3));
	g.setIndex(new BufferAttribute(indices, 1));
	g.computeBoundingSphere();
	return g;
}

/** A vertical band standing on a plan polyline, used for fences, hedges and kerbs. */
export function ribbonToGeometry(
	spine: readonly Vec2[],
	height: number,
	base = 0,
	closed = false
): BufferGeometry | null {
	const pts = closed ? [...spine, spine[0]] : spine;
	if (pts.length < 2) return null;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	let run = 0;
	for (let i = 0; i < pts.length; i++) {
		if (i > 0) run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		positions.push(pts[i].x, base, -pts[i].y, pts[i].x, base + height, -pts[i].y);
		uvs.push(run, 0, run, height);
	}
	for (let i = 0; i < pts.length - 1; i++) {
		const a = i * 2;
		indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
	g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
	g.setIndex(indices);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/** A closed prism from a plan ring, for a raised bed, a kerb or a simple box. */
export function prismToGeometry(
	ring: readonly Vec2[],
	base: number,
	top: number
): BufferGeometry | null {
	const cap = ringToGeometry(ring, [], top);
	if (!cap) return null;
	const side = ribbonToGeometry(ring, top - base, base, true);
	if (!side) return cap;

	const merged = new BufferGeometry();
	const parts = [cap, side];
	let vertCount = 0;
	let idxCount = 0;
	for (const p of parts) {
		vertCount += p.getAttribute('position').count;
		idxCount += p.getIndex()?.count ?? 0;
	}
	const positions = new Float32Array(vertCount * 3);
	const uvs = new Float32Array(vertCount * 2);
	const indices = new Uint32Array(idxCount);
	let vo = 0;
	let io = 0;
	for (const p of parts) {
		const pos = p.getAttribute('position');
		const uv = p.getAttribute('uv');
		const idx = p.getIndex();
		positions.set(pos.array as Float32Array, vo * 3);
		if (uv) uvs.set(uv.array as Float32Array, vo * 2);
		if (idx) for (let i = 0; i < idx.count; i++) indices[io + i] = idx.getX(i) + vo;
		vo += pos.count;
		io += idx?.count ?? 0;
	}
	merged.setAttribute('position', new BufferAttribute(positions, 3));
	merged.setAttribute('uv', new BufferAttribute(uvs, 2));
	merged.setIndex(new BufferAttribute(indices, 1));
	merged.computeVertexNormals();
	merged.computeBoundingSphere();
	cap.dispose();
	side.dispose();
	return merged;
}
