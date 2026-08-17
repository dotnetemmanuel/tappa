import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/doc.js';
import { makeSpot, makeWall } from '../doc/factory.js';
import type { Doc, WallEntity } from '../doc/types.js';
import { buildField, heightAt, type HeightField } from '../terrain/field.js';
import type { Solid } from './solid.js';
import { wallParts } from './wallgraph.js';

/** Falls 1 m over 5 m towards the east, dead level north to south. */
function sloping(): { doc: Doc; field: HeightField; wall: WallEntity } {
	const doc = createDoc();
	doc.entities.push(makeSpot({ x: 0, y: 0 }, 0));
	doc.entities.push(makeSpot({ x: 5, y: 0 }, -1));
	doc.entities.push(makeSpot({ x: 0, y: 8 }, 0));
	doc.nodes['node-a'] = { x: 0, y: 4 };
	doc.nodes['node-b'] = { x: 5, y: 4 };
	const wall = makeWall('node-a', 'node-b', 0.25, 2.5);
	doc.entities.push(wall);
	const field = buildField(doc);
	if (!field) throw new Error('expected a field');
	return { doc, field, wall };
}

function yRange(s: Solid): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;
	for (let i = 1; i < s.positions.length; i += 3) {
		if (s.positions[i] < min) min = s.positions[i];
		if (s.positions[i] > max) max = s.positions[i];
	}
	return { min, max };
}

describe('wallParts', () => {
	it('keeps the top level and drops the base to the ground it stands on', () => {
		const { doc, field, wall } = sloping();
		const parts = wallParts(doc, { ...wall, floor: 0 }, field);
		expect(yRange(parts.storey).max).toBeCloseTo(2.5, 6);
		expect(yRange(parts.storey).min).toBeCloseTo(0, 6);
		// The low end is at −1, and the footing goes 0.2 below that.
		expect(parts.foot).toBeCloseTo(-1.2, 1);
		expect(yRange(parts.base).min).toBeCloseTo(parts.foot, 6);
	});

	it('never leaves the ground standing above the bottom of the wall', () => {
		const { doc, field, wall } = sloping();
		const parts = wallParts(doc, { ...wall, floor: 0 }, field);
		for (let x = 0; x <= 5; x += 0.25) {
			expect(parts.foot).toBeLessThan(heightAt(field, x, 4));
		}
	});

	it('builds exactly the old wall on flat ground', () => {
		const { doc, wall } = sloping();
		const flat = wallParts(doc, wall, null);
		expect(flat.base.indices.length).toBe(0);
		expect(yRange(flat.storey)).toEqual({ min: 0, max: 2.5 });
	});

	it('lifts the whole house when the floor is set', () => {
		const { doc, field, wall } = sloping();
		const parts = wallParts(doc, { ...wall, floor: 1.5 }, field);
		expect(yRange(parts.storey).min).toBeCloseTo(1.5, 6);
		expect(yRange(parts.storey).max).toBeCloseTo(4, 6);
		expect(yRange(parts.base).max).toBeCloseTo(1.5, 6);
	});

	it('measures an opening from the finished floor', () => {
		const { doc, field, wall } = sloping();
		const withWindow: WallEntity = {
			...wall,
			floor: 1.5,
			openings: [{ id: 'op-1', type: 'window', t: 0.5, width: 1.2, height: 1.2, sill: 0.9 }]
		};
		const parts = wallParts(doc, withWindow, field);
		expect(holeHeights(parts.storey)).toContainEqual(expect.closeTo(2.4, 3));
		expect(holeHeights(parts.storey)).toContainEqual(expect.closeTo(3.6, 3));
	});

	it('puts a window with a negative sill in the base storey', () => {
		const { doc, field, wall } = sloping();
		const walkOut: WallEntity = {
			...wall,
			floor: 0,
			openings: [{ id: 'op-1', type: 'window', t: 0.5, width: 1.2, height: 1, sill: -1 }]
		};
		const parts = wallParts(doc, walkOut, field);
		expect(holeHeights(parts.base)).toContainEqual(expect.closeTo(-1, 3));
		expect(holeHeights(parts.storey)).not.toContainEqual(expect.closeTo(-1, 3));
	});
});

/** Heights that appear in a solid but are not one of its own top or bottom faces. */
function holeHeights(s: Solid): number[] {
	const range = yRange(s);
	const out = new Set<number>();
	for (let i = 1; i < s.positions.length; i += 3) {
		const y = s.positions[i];
		if (Math.abs(y - range.min) > 1e-6 && Math.abs(y - range.max) > 1e-6) out.add(y);
	}
	return [...out];
}
