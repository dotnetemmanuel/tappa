import { describe, expect, it } from 'vitest';
import { createDoc, docBounds } from '../doc/doc.js';
import { makeArea, makeSpot } from '../doc/factory.js';
import type { AreaEntity, Doc, Grade } from '../doc/types.js';
import type { Vec2 } from '../geom/vec2.js';
import { buildField, heightAt, type HeightField } from './field.js';

function withSpots(...spots: [number, number, number][]): Doc {
	const doc = createDoc();
	for (const [x, y, z] of spots) doc.entities.push(makeSpot({ x, y }, z));
	return doc;
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
	return [
		{ x: x0, y: y0 },
		{ x: x1, y: y0 },
		{ x: x1, y: y1 },
		{ x: x0, y: y1 }
	];
}

function graded(ring: Vec2[], grade: Grade): AreaEntity {
	return { ...makeArea(ring, 'lawn'), grade };
}

function must(f: HeightField | null): HeightField {
	// The tests that call this have built a field on purpose, so a null is the failure.
	if (!f) throw new Error('expected a field');
	return f;
}

describe('buildField', () => {
	it('gives no field at all to a document with no heights', () => {
		const doc = createDoc();
		doc.entities.push(makeArea(rect(0, 0, 10, 10), 'lawn'));
		expect(buildField(doc)).toBeNull();
	});

	it('spreads a single height over everything', () => {
		const f = must(buildField(withSpots([2, 2, 1.4])));
		expect(heightAt(f, 2, 2)).toBeCloseTo(1.4, 6);
		expect(heightAt(f, -40, 55)).toBeCloseTo(1.4, 6);
	});

	it('runs two heights linearly along their line and flat across it', () => {
		const f = must(buildField(withSpots([0, 0, 0], [10, 0, -2])));
		expect(heightAt(f, 5, 0)).toBeCloseTo(-1, 3);
		expect(heightAt(f, 5, 4)).toBeCloseTo(-1, 3);
		expect(heightAt(f, 2.5, -3)).toBeCloseTo(-0.5, 3);
	});

	it('gives a dead even slope for three heights', () => {
		const f = must(buildField(withSpots([0, 0, 0], [20, 0, -2], [0, 20, 1])));
		const plane = (x: number, y: number): number => -0.1 * x + 0.05 * y;
		for (const [x, y] of [
			[0, 0],
			[20, 0],
			[0, 20],
			[7, 13],
			[18.5, 3.25]
		]) {
			expect(heightAt(f, x, y)).toBeCloseTo(plane(x, y), 3);
		}
	});

	it('passes through every height it was given', () => {
		const spots: [number, number, number][] = [
			[0, 0, 0],
			[20, 0, -1.8],
			[0, 20, 0.4],
			[20, 20, -1.2],
			[10, 10, 1.6]
		];
		const f = must(buildField(withSpots(...spots)));
		for (const [x, y, z] of spots) expect(heightAt(f, x, y)).toBeCloseTo(z, 1);
	});

	it('holds a levelled area flat and leaves a hard edge as a step', () => {
		const doc = withSpots([0, 0, 0], [20, 0, -2], [0, 20, 0]);
		doc.entities.push(graded(rect(6, 6, 14, 14), { level: -1.5, edge: 'wall', run: 2 }));
		const f = must(buildField(doc));
		expect(heightAt(f, 10, 10)).toBeCloseTo(-1.5, 6);
		expect(heightAt(f, 6.5, 9)).toBeCloseTo(-1.5, 6);
		expect(heightAt(f, 5.5, 9)).toBeCloseTo(-0.55, 1);
	});

	it('ramps a bank from the level to the ground over its run', () => {
		const doc = withSpots([0, 0, 0], [20, 0, 0], [0, 20, 0]);
		doc.entities.push(graded(rect(6, 6, 14, 14), { level: -1, edge: 'bank', run: 2 }));
		const f = must(buildField(doc));
		expect(heightAt(f, 10, 10)).toBeCloseTo(-1, 6);
		expect(heightAt(f, 3.9, 10)).toBeCloseTo(0, 3);
		const mid = heightAt(f, 5, 10);
		expect(mid).toBeGreaterThan(-1);
		expect(mid).toBeLessThan(0);
	});

	it('lets the later levelled area win where two overlap', () => {
		const doc = withSpots([0, 0, 0], [20, 0, 0], [0, 20, 0]);
		doc.entities.push(graded(rect(0, 0, 12, 12), { level: -1, edge: 'wall', run: 1 }));
		doc.entities.push(graded(rect(8, 8, 20, 20), { level: -3, edge: 'wall', run: 1 }));
		const f = must(buildField(doc));
		expect(heightAt(f, 10, 10)).toBeCloseTo(-3, 6);
		expect(heightAt(f, 4, 4)).toBeCloseTo(-1, 6);
	});

	it('reaches ten metres past everything drawn', () => {
		const doc = withSpots([0, 0, 0], [20, 0, -2], [0, 20, 1]);
		const b = docBounds(doc);
		const f = must(buildField(doc));
		expect(f.x0).toBeLessThanOrEqual(b.min.x - 10);
		expect(f.y0).toBeLessThanOrEqual(b.min.y - 10);
		expect(f.x0 + (f.nx - 1) * f.cell).toBeGreaterThanOrEqual(b.max.x + 10);
		expect(f.y0 + (f.ny - 1) * f.cell).toBeGreaterThanOrEqual(b.max.y + 10);
	});

	it('coarsens the grid rather than growing without bound on a huge plot', () => {
		const doc = withSpots([0, 0, 0], [400, 0, -6], [0, 400, 2]);
		const f = must(buildField(doc));
		expect(f.nx * f.ny).toBeLessThanOrEqual(250_000);
		expect(f.cell).toBeGreaterThan(0.25);
	});

	it('ignores a levelled area whose ring collapses', () => {
		const doc = withSpots([0, 0, 1]);
		doc.entities.push(graded([{ x: 1, y: 1 }, { x: 1, y: 1 }], { level: -9, edge: 'wall', run: 1 }));
		const f = must(buildField(doc));
		expect(heightAt(f, 1, 1)).toBeCloseTo(1, 6);
	});
});

describe('heightAt', () => {
	it('reads flat ground from no field at all', () => {
		expect(heightAt(null, 12, -30)).toBe(0);
	});
});

describe('height points strung out along one line', () => {
	/** Every point the side view makes lands on the same section, so this is the normal case. */
	const onALine = (zs: [number, number, number]): Doc => {
		const doc = createDoc();
		zs.forEach((z, i) => doc.entities.push(makeSpot({ x: i * 10, y: 10 }, z)));
		return doc;
	};

	it('digs the dip you put in the middle of them', () => {
		const f = must(buildField(onALine([0, -2, 0])));
		expect(heightAt(f, 10, 10)).toBeCloseTo(-2, 2);
		expect(heightAt(f, 0, 10)).toBeCloseTo(0, 2);
		expect(heightAt(f, 20, 10)).toBeCloseTo(0, 2);
	});

	it('carries the dip out across the line rather than inventing a crossfall', () => {
		const f = must(buildField(onALine([0, -2, 0])));
		// Six metres out to either side the dip has eased off a little, and no further.
		for (const y of [4, 10, 16]) {
			expect(heightAt(f, 10, y)).toBeLessThan(-1.5);
			expect(heightAt(f, 10, y)).toBeGreaterThan(-2.5);
		}
	});

	it('keeps its head when a point sits a few centimetres off the line', () => {
		const doc = createDoc();
		doc.entities.push(makeSpot({ x: 0, y: 10 }, 0));
		doc.entities.push(makeSpot({ x: 7, y: 10 }, -0.5));
		doc.entities.push(makeSpot({ x: 12, y: 9.85 }, -1.5));
		doc.entities.push(makeSpot({ x: 20, y: 10 }, -2));
		const f = must(buildField(doc));
		// The plot is 20 m deep; before, a 15 cm sideways offset threw its edges hundreds of metres.
		const onTheLine = heightAt(f, 10, 10);
		for (const y of [0, 20]) {
			expect(Math.abs(heightAt(f, 10, y) - onTheLine)).toBeLessThan(0.5);
		}
		expect(heightAt(f, 12, 9.85)).toBeCloseTo(-1.5, 2);
	});

	it('still passes through every height it was given', () => {
		const doc = createDoc();
		const zs = [0, 0, -2, -2];
		zs.forEach((z, i) => doc.entities.push(makeSpot({ x: 2 + i * 5, y: 10 }, z)));
		const f = must(buildField(doc));
		zs.forEach((z, i) => expect(heightAt(f, 2 + i * 5, 10)).toBeCloseTo(z, 2));
	});
});
