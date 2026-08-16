import type { Vec2 } from '../geom/vec2.js';

/**
 * Renderer-neutral triangle soup in metres, right-handed with y up.
 * Plan x maps to x and plan y maps to -z, done once here so no builder has to
 * remember the flip.
 */
export type Solid = {
	/** Flat xyz triples. */
	positions: number[];
	/** Triangle indices into `positions`. */
	indices: number[];
	/** Optional flat uv pairs, one per vertex. */
	uvs?: number[];
};

export const emptySolid = (): Solid => ({ positions: [], indices: [], uvs: [] });

/** Plan coordinates to scene coordinates. */
export const toScene = (p: Vec2, y = 0): [number, number, number] => [p.x, y, -p.y];

export function pushVertex(s: Solid, x: number, y: number, z: number, u = 0, v = 0): number {
	const i = s.positions.length / 3;
	s.positions.push(x, y, z);
	s.uvs?.push(u, v);
	return i;
}

export function pushTriangle(s: Solid, a: number, b: number, c: number): void {
	s.indices.push(a, b, c);
}

export function pushQuad(s: Solid, a: number, b: number, c: number, d: number): void {
	s.indices.push(a, b, c, a, c, d);
}

export function mergeSolids(parts: readonly Solid[]): Solid {
	const out = emptySolid();
	for (const p of parts) {
		const offset = out.positions.length / 3;
		out.positions.push(...p.positions);
		if (p.uvs) out.uvs?.push(...p.uvs);
		else out.uvs?.push(...new Array((p.positions.length / 3) * 2).fill(0));
		for (const i of p.indices) out.indices.push(i + offset);
	}
	return out;
}

export function translateSolid(s: Solid, dx: number, dy: number, dz: number): Solid {
	const positions = s.positions.slice();
	for (let i = 0; i < positions.length; i += 3) {
		positions[i] += dx;
		positions[i + 1] += dy;
		positions[i + 2] += dz;
	}
	return { positions, indices: s.indices.slice(), uvs: s.uvs?.slice() };
}

/** Bounding box in scene space, for fitting a shadow camera. */
export function solidBounds(s: Solid): { min: [number, number, number]; max: [number, number, number] } {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < s.positions.length; i += 3) {
		for (let a = 0; a < 3; a++) {
			const v = s.positions[i + a];
			if (v < min[a]) min[a] = v;
			if (v > max[a]) max[a] = v;
		}
	}
	return { min, max };
}
