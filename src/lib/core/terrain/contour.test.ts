import { describe, expect, it } from 'vitest';
import { segIntersect, type Vec2 } from '../geom/vec2.js';
import { contourLines } from './contour.js';
import type { HeightField } from './field.js';

function fieldOf(nx: number, ny: number, cell: number, z: (x: number, y: number) => number): HeightField {
	const f: HeightField = { x0: 0, y0: 0, cell, nx, ny, h: new Float32Array(nx * ny) };
	for (let j = 0; j < ny; j++) {
		for (let i = 0; i < nx; i++) f.h[j * nx + i] = z(i * cell, j * cell);
	}
	return f;
}

/** Falls 1 m over 10 m towards the east. */
const slope = (): HeightField => fieldOf(41, 41, 0.25, (x) => -x / 10);

const cone = (): HeightField =>
	fieldOf(81, 81, 0.25, (x, y) => 4 - Math.hypot(x - 10, y - 10) / 2);

// Lifted off zero: the level that lands exactly on a saddle point is two crossing lines, correctly.
const saddle = (): HeightField =>
	fieldOf(81, 81, 0.25, (x, y) => ((x - 10) * (x - 10) - (y - 10) * (y - 10)) / 20 + 0.13);

function crosses(a: readonly Vec2[], b: readonly Vec2[]): boolean {
	for (let i = 1; i < a.length; i++) {
		for (let j = 1; j < b.length; j++) {
			if (segIntersect(a[i - 1], a[i], b[j - 1], b[j])) return true;
		}
	}
	return false;
}

describe('contourLines', () => {
	it('draws an even slope as straight parallel lines at the right heights', () => {
		const lines = contourLines(slope(), 0.25);
		// −1 sits exactly on the field edge, where a contour is a boundary rather than a line.
		expect(lines.map((l) => l.z).sort((p, q) => p - q)).toEqual([-0.75, -0.5, -0.25, 0]);
		for (const l of lines) {
			const xs = l.pts.map((p) => p.x);
			expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01);
			expect(l.pts.every((p) => Math.abs(-p.x / 10 - l.z) < 0.01)).toBe(true);
		}
		const at = (z: number): number => lines.find((l) => l.z === z)?.pts[0].x ?? NaN;
		expect(at(-0.5) - at(-0.25)).toBeCloseTo(2.5, 2);
	});

	it('draws a cone as closed rings at the right height', () => {
		const lines = contourLines(cone(), 1).filter((l) =>
			l.pts.every((p) => p.x > 0.5 && p.y > 0.5 && p.x < 19.5 && p.y < 19.5)
		);
		expect(lines.length).toBeGreaterThan(2);
		for (const l of lines) {
			const first = l.pts[0];
			const last = l.pts[l.pts.length - 1];
			expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(1e-6);
			for (const p of l.pts) {
				expect(4 - Math.hypot(p.x - 10, p.y - 10) / 2).toBeCloseTo(l.z, 1);
			}
		}
	});

	it('never crosses itself over a saddle', () => {
		const lines = contourLines(saddle(), 0.5);
		expect(lines.length).toBeGreaterThan(2);
		for (let i = 0; i < lines.length; i++) {
			for (let j = i + 1; j < lines.length; j++) {
				if (lines[i].z !== lines[j].z) continue;
				expect(crosses(lines[i].pts, lines[j].pts)).toBe(false);
			}
		}
	});

	it('draws nothing above or below the ground it was given', () => {
		const lines = contourLines(slope(), 0.25);
		expect(lines.every((l) => l.z >= -1 && l.z <= 0)).toBe(true);
	});

	it('refuses an interval that would never end', () => {
		expect(contourLines(slope(), 0)).toEqual([]);
		expect(contourLines(slope(), -0.5)).toEqual([]);
		expect(contourLines(slope(), Number.NaN)).toEqual([]);
	});
});
