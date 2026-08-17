import { describe, expect, it } from 'vitest';
import { area } from '../geom/polygon.js';
import type { Vec2 } from '../geom/vec2.js';
import type { HeightField } from './field.js';
import { drape, groundUnder, profileAlong } from './query.js';

function fieldOf(z: (x: number, y: number) => number, cell = 0.25, span = 20): HeightField {
	const n = Math.round(span / cell) + 1;
	const f: HeightField = { x0: 0, y0: 0, cell, nx: n, ny: n, h: new Float32Array(n * n) };
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) f.h[j * n + i] = z(i * cell, j * cell);
	}
	return f;
}

const hill = (): HeightField => fieldOf((x, y) => 3 - Math.hypot(x - 10, y - 10) / 4);
const slope = (): HeightField => fieldOf((x) => -x / 10);

const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
	{ x: x0, y: y0 },
	{ x: x1, y: y0 },
	{ x: x1, y: y1 },
	{ x: x0, y: y1 }
];

describe('groundUnder', () => {
	it('finds a high point that no corner stands on', () => {
		const ring = square(6, 6, 14, 14);
		const g = groundUnder(hill(), ring);
		expect(g.max).toBeCloseTo(3, 1);
		expect(g.min).toBeLessThan(2.5);
	});

	it('reads flat ground with no field', () => {
		expect(groundUnder(null, square(0, 0, 5, 5))).toEqual({ min: 0, max: 0 });
	});

	it('works on a shape too thin to contain a grid point', () => {
		const g = groundUnder(slope(), square(4.02, 4.02, 4.08, 12));
		expect(g.max).toBeCloseTo(-0.402, 2);
		expect(g.min).toBeCloseTo(-0.408, 2);
	});
});

describe('profileAlong', () => {
	it('keeps every corner of the run', () => {
		const spine = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 5, y: 8 }
		];
		const out = profileAlong(slope(), spine, 1);
		for (const p of spine) {
			expect(out.some((s) => Math.hypot(s.at.x - p.x, s.at.y - p.y) < 1e-9)).toBe(true);
		}
		expect(out[0].at).toEqual(spine[0]);
		expect(out[out.length - 1].at).toEqual(spine[2]);
	});

	it('never leaves a gap longer than the step', () => {
		const out = profileAlong(slope(), [{ x: 0, y: 0 }, { x: 13.3, y: 0 }], 1);
		for (let i = 1; i < out.length; i++) {
			expect(Math.hypot(out[i].at.x - out[i - 1].at.x, out[i].at.y - out[i - 1].at.y)).toBeLessThanOrEqual(
				1 + 1e-9
			);
		}
	});

	it('carries the ground height at each sample', () => {
		const out = profileAlong(slope(), [{ x: 0, y: 2 }, { x: 10, y: 2 }], 2);
		for (const s of out) expect(s.z).toBeCloseTo(-s.at.x / 10, 3);
	});
});

describe('drape', () => {
	const ring = square(2, 2, 12, 6);

	it('leaves a coarse surface alone when nothing is too long', () => {
		const flat = drape(null, ring, [], 0.05, 100);
		expect(flat.index.length).toBe(6);
		for (let i = 1; i < flat.positions.length; i += 3) expect(flat.positions[i]).toBeCloseTo(0.05, 6);
	});

	it('cuts the surface down to the step and lays it on the ground', () => {
		const laid = drape(slope(), ring, [], 0.01, 0.5);
		expect(laid.index.length).toBeGreaterThan(6);
		for (let i = 0; i < laid.positions.length; i += 3) {
			const x = laid.positions[i];
			const planY = -laid.positions[i + 2];
			expect(planY).toBeGreaterThanOrEqual(2 - 1e-6);
			expect(laid.positions[i + 1]).toBeCloseTo(-x / 10 + 0.01, 3);
		}
	});

	it('keeps no edge longer than the step it was given', () => {
		const laid = drape(slope(), ring, [], 0, 0.5);
		for (let t = 0; t < laid.index.length; t += 3) {
			const p = [0, 1, 2].map((k) => {
				const v = laid.index[t + k] * 3;
				return { x: laid.positions[v], y: -laid.positions[v + 2] };
			});
			for (let k = 0; k < 3; k++) {
				const a = p[k];
				const b = p[(k + 1) % 3];
				expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(0.5 + 1e-6);
			}
		}
	});

	it('covers the ring exactly once and leaves the holes empty', () => {
		const hole = [square(5, 3, 7, 5)];
		const laid = drape(slope(), ring, hole, 0, 0.6);
		let sum = 0;
		for (let t = 0; t < laid.index.length; t += 3) {
			const p = [0, 1, 2].map((k) => {
				const v = laid.index[t + k] * 3;
				return { x: laid.positions[v], y: -laid.positions[v + 2] };
			});
			sum += Math.abs(
				(p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (p[1].y - p[0].y)
			) / 2;
			const c = { x: (p[0].x + p[1].x + p[2].x) / 3, y: (p[0].y + p[1].y + p[2].y) / 3 };
			expect(c.x > 5 && c.x < 7 && c.y > 3 && c.y < 5).toBe(false);
		}
		expect(sum).toBeCloseTo(area(ring) - area(hole[0]), 3);
	});

	it('gives nothing back for a ring that is not a shape', () => {
		expect(drape(slope(), [{ x: 0, y: 0 }, { x: 1, y: 1 }], [], 0, 1).index.length).toBe(0);
	});
});
